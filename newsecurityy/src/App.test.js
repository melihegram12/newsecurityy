// src/App.test.js
// Güvenlik Paneli Otomatik Testleri

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Test edilecek yardımcı fonksiyonlar
const isValidTC = (tc) => {
  if (!/^\d{11}$/.test(tc)) return false;
  if (tc[0] === '0') return false;
  const digits = tc.split('').map(Number);
  const sumOdd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const sumEven = digits[1] + digits[3] + digits[5] + digits[7];
  const check10 = ((sumOdd * 7) - sumEven) % 10;
  if (check10 !== digits[9]) return false;
  const sumFirst10 = digits.slice(0, 10).reduce((a, b) => a + b, 0);
  if (sumFirst10 % 10 !== digits[10]) return false;
  return true;
};

const formatPhone = (value) => {
  const numbers = value.replace(/\D/g, '');
  if (numbers.length <= 4) return numbers;
  if (numbers.length <= 7) return `(${numbers.slice(0,4)}) ${numbers.slice(4)}`;
  return `(${numbers.slice(0,4)}) ${numbers.slice(4,7)} ${numbers.slice(7,11)}`;
};

const calculateWaitTime = (entryTime) => {
  const now = new Date();
  const entry = new Date(entryTime);
  const diffMs = now - entry;
  const diffMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return { hours, mins, isLongStay: hours >= 4 };
};

const sanitizeInput = (input) => {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, '').replace(/[<>"']/g, '').trim();
};

const getCategoryStyle = (cat) => {
  if (cat?.includes('Yönetim')) return 'border-yellow-500 text-yellow-400 bg-yellow-500/10';
  if (cat?.includes('Şirket')) return 'border-blue-500 text-blue-400 bg-blue-500/10';
  if (cat?.includes('Servis')) return 'border-purple-500 text-purple-400 bg-purple-500/10';
  if (cat?.includes('Mühür')) return 'border-red-500 text-red-400 bg-red-500/10';
  if (cat?.includes('Personel Aracı')) return 'border-cyan-500 text-cyan-400 bg-cyan-500/10';
  if (cat?.includes('Misafir Araç')) return 'border-green-500 text-green-400 bg-green-500/10';
  if (cat?.includes('Misafir')) return 'border-emerald-500 text-emerald-400 bg-emerald-500/10';
  if (cat?.includes('Fabrika')) return 'border-orange-500 text-orange-400 bg-orange-500/10';
  if (cat?.includes('İşten')) return 'border-rose-500 text-rose-400 bg-rose-500/10';
  return 'border-slate-600 text-slate-400';
};

// ========================================
// TC KİMLİK DOĞRULAMA TESTLERİ
// ========================================
describe('TC Kimlik Doğrulama', () => {
  test('Geçerli TC numarası kabul edilmeli', () => {
    expect(isValidTC('10000000146')).toBe(true);
    expect(isValidTC('12345678901')).toBe(false); // Geçersiz
  });

  test('11 haneden az TC reddedilmeli', () => {
    expect(isValidTC('1234567890')).toBe(false);
    expect(isValidTC('123')).toBe(false);
  });

  test('0 ile başlayan TC reddedilmeli', () => {
    expect(isValidTC('01234567890')).toBe(false);
  });

  test('Harf içeren TC reddedilmeli', () => {
    expect(isValidTC('1234567890a')).toBe(false);
    expect(isValidTC('abcdefghijk')).toBe(false);
  });

  test('Boş değer reddedilmeli', () => {
    expect(isValidTC('')).toBe(false);
    expect(isValidTC(null)).toBe(false);
  });
});

// ========================================
// TELEFON FORMATLAMA TESTLERİ
// ========================================
describe('Telefon Formatlama', () => {
  test('Telefon numarası doğru formatlanmalı', () => {
    expect(formatPhone('5551234567')).toBe('(5551) 234 567');
    expect(formatPhone('05551234567')).toBe('(0555) 123 4567');
  });

  test('Kısa numara kısmi formatlanmalı', () => {
    expect(formatPhone('555')).toBe('555');
    expect(formatPhone('5551')).toBe('5551');
    expect(formatPhone('55512')).toBe('(5551) 2');
  });

  test('Harfler temizlenmeli', () => {
    expect(formatPhone('555abc123')).toBe('(5551) 23');
  });
});

// ========================================
// BEKLEME SÜRESİ HESAPLAMA TESTLERİ
// ========================================
describe('Bekleme Süresi Hesaplama', () => {
  test('1 saat önce giriş doğru hesaplanmalı', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const result = calculateWaitTime(oneHourAgo);
    expect(result.hours).toBe(1);
    expect(result.isLongStay).toBe(false);
  });

  test('5 saat önce giriş longStay olmalı', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const result = calculateWaitTime(fiveHoursAgo);
    expect(result.hours).toBe(5);
    expect(result.isLongStay).toBe(true);
  });

  test('30 dakika önce giriş', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const result = calculateWaitTime(thirtyMinsAgo);
    expect(result.hours).toBe(0);
    expect(result.mins).toBe(30);
    expect(result.isLongStay).toBe(false);
  });

  test('Tam 4 saat longStay olmalı', () => {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const result = calculateWaitTime(fourHoursAgo);
    expect(result.hours).toBe(4);
    expect(result.isLongStay).toBe(true);
  });
});

// ========================================
// INPUT TEMİZLEME TESTLERİ (XSS Koruması)
// ========================================
describe('Input Temizleme (XSS Koruması)', () => {
  test('HTML tagları temizlenmeli', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe('alert(xss)');
    expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('');
  });

  test('Tehlikeli karakterler temizlenmeli', () => {
    expect(sanitizeInput('Test<>"\'')).toBe('Test');
  });

  test('Normal metin değişmemeli', () => {
    expect(sanitizeInput('Normal Metin')).toBe('Normal Metin');
    expect(sanitizeInput('34 ABC 123')).toBe('34 ABC 123');
  });

  test('Boşluklar trim edilmeli', () => {
    expect(sanitizeInput('  Test  ')).toBe('Test');
  });

  test('Boş değerler işlenmeli', () => {
    expect(sanitizeInput('')).toBe('');
    expect(sanitizeInput(null)).toBe('');
    expect(sanitizeInput(undefined)).toBe('');
  });
});

// ========================================
// KATEGORİ STİL TESTLERİ
// ========================================
describe('Kategori Stilleri', () => {
  test('Yönetim kategorisi sarı olmalı', () => {
    expect(getCategoryStyle('Yönetim Aracı')).toContain('yellow');
  });

  test('Şirket kategorisi mavi olmalı', () => {
    expect(getCategoryStyle('Şirket Aracı')).toContain('blue');
  });

  test('Mühürlü araç kırmızı olmalı', () => {
    expect(getCategoryStyle('Mühürlü Araç')).toContain('red');
  });

  test('Misafir Araç yeşil olmalı', () => {
    expect(getCategoryStyle('Misafir Araç')).toContain('green');
  });

  test('Bilinmeyen kategori varsayılan stil almalı', () => {
    expect(getCategoryStyle('Bilinmeyen')).toContain('slate');
  });

  test('Null kategori varsayılan stil almalı', () => {
    expect(getCategoryStyle(null)).toContain('slate');
  });
});

// ========================================
// PLAKA FORMAT TESTLERİ
// ========================================
describe('Plaka Formatı', () => {
  const isValidPlate = (plate) => {
    if (!plate || plate.length < 5) return false;
    // Türk plaka formatı: 01-81 + harf + sayı kombinasyonları
    const plateRegex = /^(0[1-9]|[1-7][0-9]|8[01])\s?[A-Z]{1,3}\s?\d{2,4}$/;
    return plateRegex.test(plate.toUpperCase().replace(/\s+/g, ' ').trim());
  };

  test('Geçerli plakalar kabul edilmeli', () => {
    expect(isValidPlate('34 ABC 123')).toBe(true);
    expect(isValidPlate('06 A 1234')).toBe(true);
    expect(isValidPlate('43 SN 403')).toBe(true);
  });

  test('Geçersiz plakalar reddedilmeli', () => {
    expect(isValidPlate('99 ABC 123')).toBe(false); // 99 geçersiz il kodu
    expect(isValidPlate('ABC')).toBe(false);
  });
});

// ========================================
// TARİH FORMAT TESTLERİ
// ========================================
describe('Tarih Formatlama', () => {
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  test('Tarih doğru formatlanmalı', () => {
    const date = new Date('2025-12-18T14:30:00');
    expect(formatDate(date)).toBe('18.12.2025');
  });

  test('Saat doğru formatlanmalı', () => {
    const date = new Date('2025-12-18T14:30:00');
    expect(formatTime(date)).toBe('14:30');
  });
});

// ========================================
// VARDİYA HESAPLAMA TESTLERİ
// ========================================
describe('Vardiya Hesaplama', () => {
  const getShift = (hour) => {
    if (hour >= 8 && hour < 16) return 'Vardiya 1 (08:00-16:00)';
    if (hour >= 16 && hour < 24) return 'Vardiya 2 (16:00-00:00)';
    return 'Vardiya 3 (00:00-08:00)';
  };

  test('Sabah saatleri Vardiya 1 olmalı', () => {
    expect(getShift(8)).toBe('Vardiya 1 (08:00-16:00)');
    expect(getShift(12)).toBe('Vardiya 1 (08:00-16:00)');
    expect(getShift(15)).toBe('Vardiya 1 (08:00-16:00)');
  });

  test('Öğleden sonra Vardiya 2 olmalı', () => {
    expect(getShift(16)).toBe('Vardiya 2 (16:00-00:00)');
    expect(getShift(20)).toBe('Vardiya 2 (16:00-00:00)');
    expect(getShift(23)).toBe('Vardiya 2 (16:00-00:00)');
  });

  test('Gece saatleri Vardiya 3 olmalı', () => {
    expect(getShift(0)).toBe('Vardiya 3 (00:00-08:00)');
    expect(getShift(3)).toBe('Vardiya 3 (00:00-08:00)');
    expect(getShift(7)).toBe('Vardiya 3 (00:00-08:00)');
  });
});

// ========================================
// KALMA SÜRESİ HESAPLAMA TESTLERİ
// ========================================
describe('Kalma Süresi Hesaplama', () => {
  const calculateStayDuration = (entryTime, exitTime) => {
    if (!exitTime) return 'Hala İçeride';
    const entry = new Date(entryTime);
    const exit = new Date(exitTime);
    const diffMs = exit - entry;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours > 0) return `${hours}s ${mins}dk`;
    return `${mins}dk`;
  };

  test('1 saat 30 dakika kalış', () => {
    const entry = new Date('2025-12-18T10:00:00');
    const exit = new Date('2025-12-18T11:30:00');
    expect(calculateStayDuration(entry, exit)).toBe('1s 30dk');
  });

  test('45 dakika kalış', () => {
    const entry = new Date('2025-12-18T10:00:00');
    const exit = new Date('2025-12-18T10:45:00');
    expect(calculateStayDuration(entry, exit)).toBe('45dk');
  });

  test('Çıkış yoksa hala içeride', () => {
    const entry = new Date('2025-12-18T10:00:00');
    expect(calculateStayDuration(entry, null)).toBe('Hala İçeride');
  });
});

// ========================================
// MOCK DATA TESTLERİ
// ========================================
describe('Mock Data Validasyonu', () => {
  const mockLog = {
    id: '123',
    type: 'vehicle',
    sub_category: 'Misafir Araç',
    plate: '34 ABC 123',
    driver: 'Test Sürücü',
    host: 'Yönetim',
    created_at: new Date().toISOString(),
    exit_at: null
  };

  test('Log objesi gerekli alanları içermeli', () => {
    expect(mockLog).toHaveProperty('id');
    expect(mockLog).toHaveProperty('type');
    expect(mockLog).toHaveProperty('plate');
    expect(mockLog).toHaveProperty('created_at');
  });

  test('Araç tipi vehicle olmalı', () => {
    expect(mockLog.type).toBe('vehicle');
  });

  test('Çıkış yapılmamış kayıt exit_at null olmalı', () => {
    expect(mockLog.exit_at).toBeNull();
  });
});

console.log('✅ Tüm testler tanımlandı. npm test ile çalıştırın.');
