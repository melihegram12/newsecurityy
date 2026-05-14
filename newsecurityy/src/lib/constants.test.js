import {
  resolveLocalApiDefaultUrl,
  ROLE_DEVELOPER,
  ROLE_FALLBACK_PASSWORDS,
  ROLE_HR,
  ROLE_SECURITY,
  resolveRoleFallbackPasswords,
} from './constants';

describe('resolveLocalApiDefaultUrl', () => {
  test('env URL varsa onu kullanir', () => {
    expect(resolveLocalApiDefaultUrl({
      REACT_APP_LOCAL_API_URL: 'http://10.10.10.10:8000/api/',
    }, {
      protocol: 'http:',
      origin: 'http://10.166.1.23:3001',
    })).toBe('http://10.10.10.10:8000/api');
  });

  test('web origin uzerinden calisiyorsa bos env yerine same-origin api kullanir', () => {
    expect(resolveLocalApiDefaultUrl({}, {
      protocol: 'http:',
      origin: 'http://10.166.1.23:3001',
    })).toBe('http://10.166.1.23:3001/api');
  });

  test('http origin yoksa API URL uydurmaz', () => {
    expect(resolveLocalApiDefaultUrl({}, {
      protocol: 'file:',
      origin: 'null',
    })).toBe('');
  });
});

describe('resolveRoleFallbackPasswords', () => {
  test('env bos ise offline sifreleri bos kalir', () => {
    expect(resolveRoleFallbackPasswords({})).toEqual({
      [ROLE_SECURITY]: '',
      [ROLE_HR]: '',
      [ROLE_DEVELOPER]: '',
    });
  });

  test('frontend env sifrelerini kullanir', () => {
    expect(resolveRoleFallbackPasswords({
      REACT_APP_SECURITY_PASSWORD: 'CustomSecurity!',
      VITE_HR_PASSWORD: 'CustomHr!',
      REACT_APP_DEVELOPER_PASSWORD: 'CustomDev!',
    })).toEqual({
      [ROLE_SECURITY]: 'CustomSecurity!',
      [ROLE_HR]: 'CustomHr!',
      [ROLE_DEVELOPER]: 'CustomDev!',
    });
  });

  test('uygulama eski hardcoded offline sifreleri kullanmaz', () => {
    const legacyDefaults = ['Security', 'Hr', 'Dev'].map((prefix, index) => (
      index === 0 ? `${prefix}123!` : `${prefix}123456!`
    ));
    legacyDefaults.forEach((password) => {
      expect(Object.values(ROLE_FALLBACK_PASSWORDS)).not.toContain(password);
    });
  });
});
