from contextvars import ContextVar


guest_address = ContextVar("guest_address", default="")


def client_address(request):
    host = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for", "")
    if host in ("127.0.0.1", "::1") and forwarded:
        host = forwarded.split(",")[-1].strip() or host
    return host


def quota_actor(actor):
    if actor.startswith("guest:") and guest_address.get():
        return "guest-ip:" + guest_address.get()
    return actor
