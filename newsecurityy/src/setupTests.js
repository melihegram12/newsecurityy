import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

globalThis.jest = vi;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class TestStorage {
  #items = new Map();

  get length() {
    return this.#items.size;
  }

  clear() {
    this.#items.clear();
  }

  getItem(key) {
    const normalizedKey = String(key);
    return this.#items.has(normalizedKey) ? this.#items.get(normalizedKey) : null;
  }

  key(index) {
    return Array.from(this.#items.keys())[index] || null;
  }

  removeItem(key) {
    this.#items.delete(String(key));
  }

  setItem(key, value) {
    this.#items.set(String(key), String(value));
  }
}

const localStorageMock = new TestStorage();
const sessionStorageMock = new TestStorage();

Object.defineProperty(globalThis, 'Storage', {
  configurable: true,
  value: TestStorage,
});

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: sessionStorageMock,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'Storage', {
    configurable: true,
    value: TestStorage,
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: sessionStorageMock,
  });
}

afterEach(() => {
  cleanup();
});
