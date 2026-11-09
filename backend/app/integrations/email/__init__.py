"""Email adapters: console (development) and SMTP."""
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import settings
from app.core.logging import logger


class EmailSender:
    def send(self, to: str, subject: str, body: str, sender_name: str) -> None:
        raise NotImplementedError


class ConsoleEmailSender(EmailSender):
    outbox: list[dict] = []

    def send(self, to, subject, body, sender_name):
        self.outbox.append({"to": to, "subject": subject, "body": body})
        del self.outbox[:-200]
        logger.info(f"[email:console] to={to} subject={subject}\n{body}")


class SmtpEmailSender(EmailSender):
    def send(self, to, subject, body, sender_name):
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f"{sender_name} <{settings.EMAIL_FROM}>"
        msg["To"] = to
        msg.set_content(body)
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as s:
            if settings.SMTP_USE_TLS:
                s.starttls(context=ssl.create_default_context())
            if settings.SMTP_USERNAME:
                s.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            s.send_message(msg)


_console = ConsoleEmailSender()


def get_email_sender() -> EmailSender:
    if settings.EMAIL_PROVIDER == "smtp" and settings.SMTP_HOST and settings.EMAIL_FROM:
        return SmtpEmailSender()
    return _console


def console_outbox() -> list[dict]:
    return _console.outbox
