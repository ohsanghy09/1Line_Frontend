import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx2

from app.network import check_openai_connection, connection_issue


class NetworkTests(unittest.IsolatedAsyncioTestCase):
    async def test_unauthenticated_401_proves_network_reachability_without_key(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.get.return_value = SimpleNamespace(status_code=401)
        with patch('app.network.httpx2.AsyncClient', return_value=client):
            result = await check_openai_connection()
        self.assertEqual(result['connectionStatus'], 'reachable')
        self.assertEqual(client.get.call_args.args, ('https://api.openai.com/v1/models',))
        self.assertNotIn('headers', client.get.call_args.kwargs)

    async def test_blocked_socket_has_actionable_error_without_raw_details(self):
        error = httpx2.ConnectError('[WinError 10013] private-secret')
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.get.side_effect = error
        with patch('app.network.httpx2.AsyncClient', return_value=client):
            result = await check_openai_connection()
        self.assertEqual(result['code'], 'openai_network_permission')
        self.assertNotIn('private-secret', result['error'])

    def test_tls_dns_and_unknown_errors_are_distinct(self):
        for text, expected in [('CERTIFICATE_VERIFY_FAILED', 'openai_tls'),
                               ('getaddrinfo failed', 'openai_dns'), ('other error', 'openai_connection')]:
            self.assertEqual(connection_issue(RuntimeError(text))[0], expected)
