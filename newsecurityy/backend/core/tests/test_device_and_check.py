import uuid

from rest_framework.test import APITestCase

from core.models import Device, Gate, Site


class DeviceAuthAndCheckTests(APITestCase):
    def setUp(self):
        self.site = Site.objects.create(name='Tesis')
        self.gate = Gate.objects.create(site=self.site, name='Ana Kapi', code='ana-kapi')
        self.device = Device.objects.create(gate=self.gate, name='Kiosk', device_id='KIOSK-1', device_key_hash='x')
        self.device.set_device_key('secret-key')
        self.device.save()

    def _device_token(self):
        res = self.client.post('/api/device/auth', {'device_id': 'KIOSK-1', 'device_key': 'secret-key'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        return res.data['token']

    def test_check_in_out_and_rules(self):
        token = self._device_token()

        event_uuid = str(uuid.uuid4())
        res_in = self.client.post(
            '/api/check',
            {
                'client_event_uuid': event_uuid,
                'direction': 'IN',
                'badge_code': 'CARD-1',
                'person': {'kind': 'employee', 'full_name': 'Ali Veli'},
            },
            format='json',
            HTTP_AUTHORIZATION=f'Device {token}',
        )
        self.assertEqual(res_in.status_code, 201, res_in.data)
        self.assertFalse(res_in.data['duplicate'])

        # Same uuid -> idempotent
        res_dup = self.client.post(
            '/api/check',
            {
                'client_event_uuid': event_uuid,
                'direction': 'IN',
                'badge_code': 'CARD-1',
                'person': {'kind': 'employee', 'full_name': 'Ali Veli'},
            },
            format='json',
            HTTP_AUTHORIZATION=f'Device {token}',
        )
        self.assertEqual(res_dup.status_code, 200, res_dup.data)
        self.assertTrue(res_dup.data['duplicate'])

        # 2nd IN should be blocked
        res_in_again = self.client.post(
            '/api/check',
            {
                'client_event_uuid': str(uuid.uuid4()),
                'direction': 'IN',
                'badge_code': 'CARD-1',
            },
            format='json',
            HTTP_AUTHORIZATION=f'Device {token}',
        )
        self.assertEqual(res_in_again.status_code, 409, res_in_again.data)
        self.assertEqual(res_in_again.data.get('code'), 'ALREADY_INSIDE')

        # OUT
        res_out = self.client.post(
            '/api/check',
            {
                'client_event_uuid': str(uuid.uuid4()),
                'direction': 'OUT',
                'badge_code': 'CARD-1',
            },
            format='json',
            HTTP_AUTHORIZATION=f'Device {token}',
        )
        self.assertEqual(res_out.status_code, 201, res_out.data)

        # OUT again should be blocked
        res_out_again = self.client.post(
            '/api/check',
            {
                'client_event_uuid': str(uuid.uuid4()),
                'direction': 'OUT',
                'badge_code': 'CARD-1',
            },
            format='json',
            HTTP_AUTHORIZATION=f'Device {token}',
        )
        self.assertEqual(res_out_again.status_code, 409, res_out_again.data)
        self.assertEqual(res_out_again.data.get('code'), 'NOT_INSIDE')
