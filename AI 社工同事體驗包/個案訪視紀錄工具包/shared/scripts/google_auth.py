#!/usr/bin/env python3
"""
共用的 Google OAuth 授權模組。給 case-visit-approval（Gmail）用，
避免每個 skill 各自重複一份。

設定步驟見 shared/references/google-api-setup.md。這支腳本假設：
- shared/.credentials/client_secret.json 已存在（從 GCP Console 下載，
  這是每個人自己的憑證，不會共用、也不會被 commit）
- 直接執行本檔（`python3 shared/scripts/google_auth.py`）可以跑一次性授權，
  跳出瀏覽器讓使用者登入、按「允許」，完成後寫入 shared/.credentials/token.json

其他 skill 的腳本則 import 這個模組的 get_service()，自動重用/刷新已存的 token，
不會每次都跳瀏覽器。
"""
import os

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]

_CRED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".credentials")
CLIENT_SECRET_PATH = os.path.join(_CRED_DIR, "client_secret.json")
TOKEN_PATH = os.path.join(_CRED_DIR, "token.json")


def get_credentials():
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())

    if not creds or not creds.valid:
        if not os.path.exists(CLIENT_SECRET_PATH):
            raise FileNotFoundError(
                f"找不到 {CLIENT_SECRET_PATH}，請先依 shared/references/google-api-setup.md "
                "在 Google Cloud Console 建立 OAuth 用戶端 ID 並下載 client_secret.json"
            )
        flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_PATH, SCOPES)
        creds = flow.run_local_server(port=0)

    os.makedirs(_CRED_DIR, exist_ok=True)
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        f.write(creds.to_json())

    return creds


def get_service(api_name, api_version):
    """例如 get_service('gmail', 'v1')。"""
    creds = get_credentials()
    return build(api_name, api_version, credentials=creds)


if __name__ == "__main__":
    get_credentials()
    print(f"授權完成，token 已寫入：{TOKEN_PATH}")
