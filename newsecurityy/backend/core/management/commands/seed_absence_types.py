from django.core.management.base import BaseCommand

from core.models import AbsenceType


DEFAULT_TYPES = [
    {
        'code': 'rapor_saglik',
        'name': 'Rapor (Sağlık)',
        'requires_document': True,
        'is_excused_default': True,
        'affects_sgk': True,
        'default_unit': AbsenceType.DurationUnit.FULL_DAY,
    },
    {
        'code': 'yillik_izin',
        'name': 'Yıllık İzin',
        'is_paid': True,
        'affects_payroll': True,
        'is_excused_default': True,
        'default_unit': AbsenceType.DurationUnit.FULL_DAY,
    },
    {
        'code': 'ucretsiz_izin',
        'name': 'Ücretsiz İzin',
        'affects_payroll': True,
        'affects_sgk': True,
        'default_unit': AbsenceType.DurationUnit.FULL_DAY,
    },
    {
        'code': 'gec_gelme',
        'name': 'Geç Gelme',
        'affects_payroll': True,
        'default_unit': AbsenceType.DurationUnit.HOURLY,
    },
    {
        'code': 'erken_cikma',
        'name': 'Erken Çıkma',
        'affects_payroll': True,
        'default_unit': AbsenceType.DurationUnit.HOURLY,
    },
    {
        'code': 'fazla_mesaiye_gelmeme',
        'name': 'Fazla Mesaiye Gelmeme',
        'affects_payroll': True,
        'affects_premium': True,
        'default_unit': AbsenceType.DurationUnit.HOURLY,
    },
    {
        'code': 'idari_izin',
        'name': 'İdari İzin',
        'is_paid': True,
        'affects_payroll': True,
        'is_excused_default': True,
        'default_unit': AbsenceType.DurationUnit.FULL_DAY,
    },
]


class Command(BaseCommand):
    help = 'Varsayılan devamsızlık türlerini oluşturur.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--update',
            action='store_true',
            help='Mevcut türleri verilen varsayılanlarla günceller.',
        )

    def handle(self, *args, **options):
        updated = 0
        created = 0
        for item in DEFAULT_TYPES:
            obj, was_created = AbsenceType.objects.get_or_create(
                code=item['code'],
                defaults=item,
            )
            if was_created:
                created += 1
                continue
            if options['update']:
                for key, value in item.items():
                    setattr(obj, key, value)
                obj.save()
                updated += 1

        self.stdout.write(self.style.SUCCESS(f'Tamamlandı. Oluşturulan: {created}, Güncellenen: {updated}'))
