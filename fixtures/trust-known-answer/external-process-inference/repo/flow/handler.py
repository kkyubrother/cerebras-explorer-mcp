from .worker import normalize_payload


def handle(payload):
    return normalize_payload(payload)
