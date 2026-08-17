#!/usr/bin/env python3
"""
查詢主管是否已回覆確認信。印出這個 thread 裡、我們寄出之後的所有回覆內容，
交給你（Claude）判斷是「核准」還是「退件並要求修改」——這支腳本不自己猜，
因為回覆內容本來就不是要保密的敘事類資料。

用法：
    # 查詢特定 thread
    python3 check_approval.py --thread-id <thread id>

    # 自動模式：只在有 pending 的案件時才查，已回覆就輸出內容（供 Claude 判斷）
    python3 check_approval.py --auto
"""
import argparse
import base64
import json
import os
import sys

_PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "shared", "scripts"))
from google_auth import get_service  # noqa: E402

PENDING_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "pending_approvals.json")


def extract_plain_text(payload):
    if payload.get("mimeType") == "text/plain" and "data" in payload.get("body", {}):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    for part in payload.get("parts", []) or []:
        text = extract_plain_text(part)
        if text:
            return text
    return ""


def check_thread(gmail, thread_id):
    thread = gmail.users().threads().get(userId="me", id=thread_id, format="full").execute()
    messages = thread.get("messages", [])
    if len(messages) <= 1:
        return None
    replies = []
    for i, msg in enumerate(messages[1:], start=1):
        headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
        text = extract_plain_text(msg["payload"]).strip()
        replies.append(f"--- 回覆 {i}（來自 {headers.get('From', '未知')}，{headers.get('Date', '')}）---\n{text}")
    return replies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--thread-id", help="直接查詢指定 thread")
    parser.add_argument("--auto", action="store_true", help="自動模式：只查有 pending 的案件")
    args = parser.parse_args()

    if args.auto:
        if not os.path.exists(PENDING_PATH):
            # 沒有任何 pending 案件，安靜結束
            sys.exit(0)
        with open(PENDING_PATH, encoding="utf-8") as f:
            pending = json.load(f)
        if not pending:
            sys.exit(0)

        gmail = get_service("gmail", "v1")
        for case_id, info in pending.items():
            thread_id = info.get("thread_id")
            replies = check_thread(gmail, thread_id)
            if replies:
                print(f"【{case_id}】訪視紀錄確認信有新回覆（thread: {thread_id}）：\n")
                for r in replies:
                    print(r)
                    print()
            # 沒有回覆就安靜略過
        return

    # 直接查詢模式
    if not args.thread_id:
        parser.error("請提供 --thread-id 或使用 --auto 模式")

    gmail = get_service("gmail", "v1")
    replies = check_thread(gmail, args.thread_id)
    if not replies:
        print("目前這個 thread 還沒有新回覆。")
        return
    thread = gmail.users().threads().get(userId="me", id=args.thread_id, format="full").execute()
    print(f"這個 thread 共有 {len(thread.get('messages', []))} 則訊息，第一則之後為回覆：\n")
    for r in replies:
        print(r)
        print()


if __name__ == "__main__":
    main()
