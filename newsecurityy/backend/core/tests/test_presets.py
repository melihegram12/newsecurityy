from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from core.models import HostPreset, Role, UserRole, VehiclePreset


class PresetApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.hr_user = user_model.objects.create_user(username='hr_presets', password='secret123')
        self.security_user = user_model.objects.create_user(username='security_presets', password='secret123')

        self.hr_role = Role.objects.create(code='HR', name='HR')
        self.security_role = Role.objects.create(code='SECURITY', name='Security')
        UserRole.objects.create(user=self.hr_user, role=self.hr_role)
        UserRole.objects.create(user=self.security_user, role=self.security_role)

    def test_security_user_can_list_seeded_presets(self):
        self.client.force_authenticate(user=self.security_user)

        host_res = self.client.get('/api/host-presets?active=1')
        self.assertEqual(host_res.status_code, 200, host_res.data)
        self.assertGreaterEqual(len(host_res.data), 1)

        vehicle_res = self.client.get('/api/vehicle-presets?active=1&category=management')
        self.assertEqual(vehicle_res.status_code, 200, vehicle_res.data)
        self.assertGreaterEqual(len(vehicle_res.data), 1)

    def test_hr_user_can_create_and_update_presets(self):
        self.client.force_authenticate(user=self.hr_user)

        host_res = self.client.post(
            '/api/host-presets',
            {
                'name': 'Satin Alma',
                'sort_order': 12,
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(host_res.status_code, 201, host_res.data)
        host_id = host_res.data['id']

        host_patch = self.client.patch(
            f'/api/host-presets/{host_id}',
            {
                'sort_order': 3,
                'is_active': False,
            },
            format='json',
        )
        self.assertEqual(host_patch.status_code, 200, host_patch.data)
        self.assertFalse(host_patch.data['is_active'])
        self.assertEqual(host_patch.data['sort_order'], 3)

        vehicle_res = self.client.post(
            '/api/vehicle-presets',
            {
                'plate': '34 TEST 001',
                'label': 'DENEME ARACI',
                'category': VehiclePreset.Category.COMPANY,
                'default_driver_type': VehiclePreset.DefaultDriverType.OTHER,
                'sort_order': 15,
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(vehicle_res.status_code, 201, vehicle_res.data)
        self.assertEqual(vehicle_res.data['display_name'], '34 TEST 001 - DENEME ARACI')
        vehicle_id = vehicle_res.data['id']

        vehicle_patch = self.client.patch(
            f'/api/vehicle-presets/{vehicle_id}',
            {
                'label': 'GUNCEL DENEME ARACI',
                'default_driver_type': VehiclePreset.DefaultDriverType.OWNER,
                'is_active': False,
            },
            format='json',
        )
        self.assertEqual(vehicle_patch.status_code, 200, vehicle_patch.data)
        self.assertFalse(vehicle_patch.data['is_active'])
        self.assertEqual(vehicle_patch.data['default_driver_type'], VehiclePreset.DefaultDriverType.OWNER)
        self.assertEqual(vehicle_patch.data['display_name'], '34 TEST 001 - GUNCEL DENEME ARACI')

    def test_security_user_cannot_create_presets(self):
        self.client.force_authenticate(user=self.security_user)

        host_res = self.client.post('/api/host-presets', {'name': 'Yetkisiz'}, format='json')
        vehicle_res = self.client.post(
            '/api/vehicle-presets',
            {'plate': '34 YTK 001', 'category': VehiclePreset.Category.MANAGEMENT},
            format='json',
        )

        self.assertEqual(host_res.status_code, 403, host_res.data)
        self.assertEqual(vehicle_res.status_code, 403, vehicle_res.data)
        self.assertFalse(HostPreset.objects.filter(name='Yetkisiz').exists())
