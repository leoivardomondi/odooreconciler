"""cPanel Passenger WSGI entrypoint.

cPanel's Python Application tool usually starts WSGI apps. The payroll bridge
is FastAPI/ASGI, so this wraps it in a WSGI adapter for Passenger.
"""

from a2wsgi import ASGIMiddleware

from payroll_bridge.app import app as asgi_app


application = ASGIMiddleware(asgi_app)
