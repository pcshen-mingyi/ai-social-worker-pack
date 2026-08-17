#!/usr/bin/env python3
"""
把訪視紀錄 docx 直接附加在信件裡，寄一封確認信給主管（真的寄出，不是草稿）。

用法：
    python3 send_for_approval.py \
        --docx 輸出檔.docx \
        --to supervisor@mingyifoundation.org \
        --case-id CASE-001 \
        --visit-date 2026/08/04 \
        --staff-name "林社工" \
        --summary-situation "案主慢性病追蹤不穩定，交通不便為主要障礙。" \
        --summary-needs "需協助申請交通接送、居家無障礙輔具、送餐及陪伴服務。" \
        --summary-plan "安排轉介與追蹤計畫。"

簽名檔：自動抓 Gmail 帳號的簽名設定（sendAs 預設值）；若未設定則以 --staff-name 值署名。

印出：Gmail thread id（後續 check_approval.py 要用）。
"""
import argparse
import base64
import html
import json
import mimetypes
import os
import re
import sys
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

_PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "shared", "scripts"))
from google_auth import get_service  # noqa: E402


def send_email_with_attachment(gmail, to, subject, body, docx_path):
    message = MIMEMultipart()
    message["to"] = to
    message["subject"] = subject
    message.attach(MIMEText(body))

    mime_type = mimetypes.guess_type(docx_path)[0] or "application/octet-stream"
    maintype, subtype = mime_type.split("/", 1)
    with open(docx_path, "rb") as f:
        attachment = MIMEApplication(f.read(), _subtype=subtype)
    attachment.add_header(
        "Content-Disposition", "attachment", filename=os.path.basename(docx_path)
    )
    message.attach(attachment)

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    sent = gmail.users().messages().send(userId="me", body={"raw": raw}).execute()
    return sent["id"], sent["threadId"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docx", required=True)
    parser.add_argument("--to", required=True, help="主管信箱")
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--visit-date", required=True)
    parser.add_argument("--staff-name", required=True, help="訪視社工姓名")
    parser.add_argument("--summary-situation", required=True, help="現況摘要")
    parser.add_argument("--summary-needs", required=True, help="需求評估摘要")
    parser.add_argument("--summary-plan", required=True, help="處遇計畫摘要")
    args = parser.parse_args()

    # 防重複寄信：若此案號已有 pending 紀錄，直接報錯停止
    pending_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references", "pending_approvals.json")
    if os.path.exists(pending_path):
        with open(pending_path, encoding="utf-8") as f:
            existing = json.load(f)
        if args.case_id in existing:
            sys.exit(f"錯誤：{args.case_id} 已有待確認的信件（thread: {existing[args.case_id]['thread_id']}），請勿重複寄送。若要重寄，請先手動移除 pending_approvals.json 裡的該筆紀錄。")

    subject = f"訪視紀錄確認｜{args.case_id}｜{args.visit_date}"

    # 自動抓 Gmail sendAs 預設簽名；若未設定則以社工姓名署名
    gmail = get_service("gmail", "v1")
    signature = ""
    try:
        send_as_list = gmail.users().settings().sendAs().list(userId="me").execute()
        for sa in send_as_list.get("sendAs", []):
            if sa.get("isDefault") and sa.get("signature"):
                raw_sig = sa["signature"]
                raw_sig = re.sub(r"<br\s*/?>", "\n", raw_sig, flags=re.IGNORECASE)
                raw_sig = re.sub(r"<[^>]+>", "", raw_sig)
                signature = html.unescape(raw_sig).strip()
                break
    except Exception:
        pass
    if not signature:
        signature = args.staff_name

    body = (
        f"主任，您好：\n\n"
        f"這是 {args.visit_date} {args.staff_name} 的訪視紀錄，請協助確認（詳見附件）。\n\n"
        f"• 現況摘要：{args.summary_situation}\n"
        f"• 需求評估摘要：{args.summary_needs}\n"
        f"• 處遇計畫摘要：{args.summary_plan}\n\n"
        f"若您確認無誤，再麻煩請核准；如需調整，請不吝給予修改建議，"
        f"我會依建議調整後重新寄出給您確認，謝謝！\n\n"
        f"{signature}"
    )

    message_id, thread_id = send_email_with_attachment(gmail, args.to, subject, body, args.docx)

    # 記錄 pending 狀態，供自動監控使用
    pending = {}
    if os.path.exists(pending_path):
        with open(pending_path, encoding="utf-8") as f:
            pending = json.load(f)
    pending[args.case_id] = {"thread_id": thread_id, "to": args.to, "visit_date": args.visit_date}
    with open(pending_path, "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)

    print(f"已寄出確認信給 {args.to}（訪視紀錄 docx 已附加在信件中）")
    print(f"Gmail thread id：{thread_id}")


if __name__ == "__main__":
    main()
