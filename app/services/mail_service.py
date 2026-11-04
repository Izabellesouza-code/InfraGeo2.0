"""Envio de e-mail via SMTP (Locaweb)."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.config import get_settings
from app.core.exceptions import WebGISException


def send_email(to_address: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    settings = get_settings()
    host = (settings.smtp_host or "").strip()
    sender = (settings.smtp_from or settings.smtp_user or "").strip()
    password = (settings.smtp_password or "").strip()

    if not (host and sender and password):
        raise WebGISException(
            "Para o código chegar no e-mail, configure SMTP_HOST, SMTP_USER e SMTP_PASSWORD da Locaweb no .env.",
            status_code=500,
        )

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
            "Não foi possível enviar o e-mail. Verifique o SMTP da Locaweb no .env.",
            status_code=500,
            details={"error": str(exc)},
        ) from exc
