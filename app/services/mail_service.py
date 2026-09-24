"""Envio de e-mail via SMTP (Gmail) ou Outlook no Windows."""

from __future__ import annotations

import json
import os
import smtplib
import subprocess
from email.message import EmailMessage

from app.config import get_settings
from app.core.exceptions import WebGISException


def send_email(to_address: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    settings = get_settings()
    host = (settings.smtp_host or "").strip()
    sender = (settings.smtp_from or settings.smtp_user or "").strip()
    password = (settings.smtp_password or "").strip()

    if host and sender and password:
        _send_smtp(
            host=host,
            port=int(settings.smtp_port or 587),
            user=(settings.smtp_user or "").strip(),
            password=password,
            sender=sender,
            to_address=to_address,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            use_tls=bool(settings.smtp_use_tls),
            use_ssl=bool(settings.smtp_use_ssl),
        )
        return

    if _send_outlook(to_address, subject, body_text):
        return

    raise WebGISException(
        "Para o código chegar no e-mail, cole a senha de app do Gmail em SMTP_PASSWORD no .env.",
        status_code=500,
    )


def _send_smtp(
    *,
    host: str,
    port: int,
    user: str,
    password: str,
    sender: str,
    to_address: str,
    subject: str,
    body_text: str,
    body_html: str | None,
    use_tls: bool,
    use_ssl: bool,
) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_address
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
                if user:
                    smtp.login(user, password)
                smtp.send_message(msg)
            return
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.ehlo()
            if use_tls:
                smtp.starttls()
                smtp.ehlo()
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
    except Exception as exc:  # noqa: BLE001
        raise WebGISException(
            "Não foi possível enviar o e-mail. Verifique a senha de app do Gmail no .env.",
            status_code=500,
            details={"error": str(exc)},
        ) from exc


def _send_outlook(to_address: str, subject: str, body_text: str) -> bool:
    payload = json.dumps(
        {"to": to_address, "subject": subject, "body": body_text},
        ensure_ascii=True,
    )
    script = (
        "$d = ConvertFrom-Json -InputObject $env:INFRA_MAIL_JSON; "
        "$o = New-Object -ComObject Outlook.Application; "
        "$m = $o.CreateItem(0); "
        "$m.To = $d.to; $m.Subject = $d.subject; $m.Body = $d.body; $m.Send();"
    )
    try:
        env = os.environ.copy()
        env["INFRA_MAIL_JSON"] = payload
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=40,
            env=env,
        )
        return completed.returncode == 0
    except Exception:  # noqa: BLE001
        return False
