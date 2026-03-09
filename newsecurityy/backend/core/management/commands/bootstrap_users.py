import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import Role, UserRole


DEFAULT_ROLE_DEFS = [
    {'code': 'SECURITY', 'name': 'Güvenlik'},
    {'code': 'HR', 'name': 'İnsan Kaynakları'},
    {'code': 'DEVELOPER', 'name': 'Geliştirici'},
]

DEFAULT_USERS = [
    {
        # Username alaninda bosluk desteklenmez; login endpoint'i
        # "Güvenlik Personeli" gibi etiketleri alias olarak kabul eder.
        'username': 'güvenlik_personeli',
        'email': 'guvenlik@local',
        'role_code': 'SECURITY',
        'password_env': 'APP_SECURITY_PASSWORD',
        'password_default': '',
        'legacy_usernames': ['security'],
    },
    {
        'username': 'insan_kaynakları',
        'email': 'ik@local',
        'role_code': 'HR',
        'password_env': 'APP_HR_PASSWORD',
        'password_default': '',
        'legacy_usernames': ['hr'],
    },
    {
        'username': 'geliştirici',
        'email': 'gelistirici@local',
        'role_code': 'DEVELOPER',
        'password_env': 'APP_DEVELOPER_PASSWORD',
        'password_default': '',
        'legacy_usernames': ['developer'],
    },
]


class Command(BaseCommand):
    help = 'Rolleri ve varsayilan SECURITY/HR/DEVELOPER kullanicilarini olusturur.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset-passwords',
            action='store_true',
            help='Mevcut kullanicilarin sifrelerini de varsayilan/env degeri ile gunceller.',
        )

    def handle(self, *args, **options):
        reset_passwords = options['reset_passwords']
        User = get_user_model()

        for role_def in DEFAULT_ROLE_DEFS:
            Role.objects.get_or_create(
                code=role_def['code'],
                defaults={'name': role_def['name'], 'description': '', 'is_active': True},
            )

        created_users = 0
        updated_passwords = 0
        assigned_roles = 0
        renamed_users = 0

        for user_def in DEFAULT_USERS:
            # docker-compose ile env tanimli ama bos gelebilir.
            password = os.environ.get(user_def['password_env']) or user_def['password_default']
            target_username = user_def['username']

            if not password:
                self.stdout.write(self.style.WARNING(
                    f'  {target_username}: sifre yok ({user_def["password_env"]} env degiskeni tanimlanmali), atlanıyor.'
                ))
                continue
            user = User.objects.filter(username=target_username).first()
            was_created = False

            if not user:
                legacy_usernames = user_def.get('legacy_usernames') or []
                legacy = None
                for candidate in legacy_usernames:
                    legacy = User.objects.filter(username=candidate).first()
                    if legacy:
                        break

                if legacy:
                    legacy.username = target_username
                    legacy.email = user_def['email']
                    legacy.save(update_fields=['username', 'email'])
                    user = legacy
                    renamed_users += 1
                else:
                    user = User.objects.create(
                        username=target_username,
                        email=user_def['email'],
                        is_active=True,
                    )
                    was_created = True

            if was_created:
                created_users += 1
                user.set_password(password)
                user.save(update_fields=['password'])
            elif reset_passwords:
                user.set_password(password)
                user.save(update_fields=['password'])
                updated_passwords += 1
            elif user_def.get('email') and user.email != user_def['email']:
                user.email = user_def['email']
                user.save(update_fields=['email'])

            role = Role.objects.get(code=user_def['role_code'])
            _, role_created = UserRole.objects.get_or_create(user=user, role=role)
            if role_created:
                assigned_roles += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Tamamlandi. Kullanici: +{created_users}, yeniden adlandirma: {renamed_users}, sifre guncelleme: {updated_passwords}, yeni rol atama: {assigned_roles}'
            )
        )
        self.stdout.write('Varsayilan kullanicilar: güvenlik_personeli / insan_kaynakları / geliştirici')
        self.stdout.write('Sifreler env degiskenlerinden alinabilir:')
        self.stdout.write('  APP_SECURITY_PASSWORD, APP_HR_PASSWORD, APP_DEVELOPER_PASSWORD')
