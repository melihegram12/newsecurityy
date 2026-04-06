from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from core.models import Badge, Person, Role, UserRole


class PersonAndBadgeApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username='hr_user', password='secret123')
        self.hr_role = Role.objects.create(code='HR', name='HR')
        UserRole.objects.create(user=self.user, role=self.hr_role)
        self.client.force_authenticate(user=self.user)

    def test_create_and_list_persons(self):
        res = self.client.post(
            '/api/persons',
            {
                'kind': Person.Kind.EMPLOYEE,
                'full_name': 'Ayse Yilmaz',
                'tc_no': '12345678901',
                'phone': '5551234567',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['full_name'], 'Ayse Yilmaz')

        list_res = self.client.get('/api/persons?kind=employee')
        self.assertEqual(list_res.status_code, 200, list_res.data)
        results = list_res.data.get('results', list_res.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['full_name'], 'Ayse Yilmaz')

    def test_create_and_list_badges(self):
        person = Person.objects.create(kind=Person.Kind.EMPLOYEE, full_name='Mehmet Demir')

        res = self.client.post(
            '/api/badges',
            {
                'person': str(person.id),
                'kind': Badge.Kind.CARD,
                'code': 'CARD-0001',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['person_name'], 'Mehmet Demir')

        list_res = self.client.get('/api/badges?q=CARD-0001')
        self.assertEqual(list_res.status_code, 200, list_res.data)
        results = list_res.data.get('results', list_res.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['code'], 'CARD-0001')

    def test_update_person_and_badge(self):
        person = Person.objects.create(kind=Person.Kind.EMPLOYEE, full_name='Zeynep Kaya', is_active=True)
        badge = Badge.objects.create(person=person, kind=Badge.Kind.CARD, code='CARD-0099', is_active=True)

        person_res = self.client.patch(
            f'/api/persons/{person.id}',
            {
                'phone': '5550001122',
                'is_active': False,
            },
            format='json',
        )
        self.assertEqual(person_res.status_code, 200, person_res.data)
        self.assertEqual(person_res.data['phone'], '5550001122')
        self.assertFalse(person_res.data['is_active'])

        badge_res = self.client.patch(
            f'/api/badges/{badge.id}',
            {
                'code': 'CARD-0100',
                'is_active': False,
            },
            format='json',
        )
        self.assertEqual(badge_res.status_code, 200, badge_res.data)
        self.assertEqual(badge_res.data['code'], 'CARD-0100')
        self.assertFalse(badge_res.data['is_active'])
