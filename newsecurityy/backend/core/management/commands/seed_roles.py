from django.core.management.base import BaseCommand

from core.models import Role


DEFAULT_ROLES = [
    {'code': 'SECURITY', 'name': 'Güvenlik'},
    {'code': 'ADMIN', 'name': 'Admin'},
    {'code': 'DEVELOPER', 'name': 'Geliştirici'},
    {'code': 'HR', 'name': 'İnsan Kaynakları'},
    {'code': 'MANAGER', 'name': 'Amir/Yönetici'},
    {'code': 'ACCOUNTING', 'name': 'Muhasebe'},
]


class Command(BaseCommand):
    help = 'Varsayılan kullanıcı rollerini oluşturur.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--update',
            action='store_true',
            help='Mevcut rolleri varsayılanlarla günceller.',
        )

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for item in DEFAULT_ROLES:
            obj, was_created = Role.objects.get_or_create(code=item['code'], defaults=item)
            if was_created:
                created += 1
                continue
            if options['update']:
                obj.name = item['name']
                obj.save()
                updated += 1

        self.stdout.write(self.style.SUCCESS(f'Tamamlandı. Oluşturulan: {created}, Güncellenen: {updated}'))
