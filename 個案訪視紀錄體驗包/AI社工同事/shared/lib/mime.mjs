/**
 * 組一封含附件的 MIME 郵件（取代 Python 的 email.mime）。
 *
 * 中文一定要處理編碼：
 *   主旨      RFC 2047 的 =?UTF-8?B?…?=
 *   本文      base64 + charset=utf-8
 *   附件檔名  RFC 2231 的 filename*=UTF-8''…（Gmail 與 Outlook 都吃）
 * 不處理的話中文會變亂碼——這個工具包的檔名幾乎都是中文。
 */
const b64 = (buf) => Buffer.from(buf).toString("base64").replace(/(.{76})/g, "$1\r\n");
const encodeHeader = (s) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

export function buildMessage({ to, subject, body, attachment }) {
  const boundary = "mymate_" + Math.random().toString(36).slice(2, 12);
  const head = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(Buffer.from(body, "utf8")),
  ];
  if (attachment) {
    const name = attachment.filename;
    const encoded = encodeURIComponent(name);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename*=UTF-8''${encoded}`,
      "",
      b64(attachment.data),
    );
  }
  parts.push(`--${boundary}--`, "");
  return [...head, ...parts].join("\r\n");
}

/** Gmail API 要的是 base64url 的整封信 */
export const toRaw = (mime) =>
  Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
