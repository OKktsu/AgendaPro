import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatCurrency,
  formatDateDisplay,
  formatShortDate,
  formatTime,
  formatTimeRange,
  getWeekdayLabel,
  parseReaisToCents,
} from './formatters.js';

describe('Formatadores do Frontend (AgendaPro)', () => {
  describe('formatCurrency', () => {
    it('formata centavos para moeda brasileira corretamente', () => {
      // Nota: toLocaleString usa espaço indivisível (\u00a0) entre R$ e o valor em alguns ambientes
      const formatted = formatCurrency(8500).replace(/\u00a0/g, ' ');
      expect(formatted).toBe('R$ 85,00');
    });

    it('formata valores com centavos parciais', () => {
      const formatted = formatCurrency(19050).replace(/\u00a0/g, ' ');
      expect(formatted).toBe('R$ 190,50');
    });

    it('formata zero corretamente', () => {
      const formatted = formatCurrency(0).replace(/\u00a0/g, ' ');
      expect(formatted).toBe('R$ 0,00');
    });

    it('retorna R$ 0,00 para valores negativos ou NaN', () => {
      expect(formatCurrency(-500)).toBe('R$ 0,00');
      expect(formatCurrency(NaN)).toBe('R$ 0,00');
    });
  });

  describe('parseReaisToCents', () => {
    it('converte string simples de inteiro para centavos', () => {
      expect(parseReaisToCents('85')).toBe(8500);
      expect(parseReaisToCents('100')).toBe(10000);
    });

    it('converte string com vírgula para centavos', () => {
      expect(parseReaisToCents('85,00')).toBe(8500);
      expect(parseReaisToCents('85,50')).toBe(8550);
      expect(parseReaisToCents('0,99')).toBe(99);
    });

    it('converte string com ponto decimal para centavos', () => {
      expect(parseReaisToCents('85.00')).toBe(8500);
      expect(parseReaisToCents('85.50')).toBe(8550);
    });

    it('converte string com prefixo R$', () => {
      expect(parseReaisToCents('R$ 85,00')).toBe(8500);
      expect(parseReaisToCents('R$85,50')).toBe(8550);
    });

    it('converte formato de milhares com ponto e vírgula', () => {
      expect(parseReaisToCents('1.250,50')).toBe(125050);
    });

    it('converte números diretamente', () => {
      expect(parseReaisToCents(85)).toBe(8500);
      expect(parseReaisToCents(85.5)).toBe(8550);
    });

    it('retorna 0 para entradas inválidas ou vazias', () => {
      expect(parseReaisToCents('')).toBe(0);
      expect(parseReaisToCents('invalido')).toBe(0);
      expect(parseReaisToCents(-10)).toBe(0);
    });
  });

  describe('formatDateDisplay', () => {
    it('formata data YYYY-MM-DD para exibição completa em pt-BR com inicial maiúscula', () => {
      const display = formatDateDisplay('2026-09-24');
      expect(display).toContain('24 de setembro de 2026');
      expect(display.toLowerCase()).toContain('quinta-feira');
    });

    it('lida com primeiro dia do mês e viradas', () => {
      const display = formatDateDisplay('2026-10-01');
      expect(display).toContain('1 de outubro de 2026');
    });
  });

  describe('formatShortDate', () => {
    it('formata YYYY-MM-DD para DD/MM', () => {
      expect(formatShortDate('2026-09-24')).toBe('24/09');
      expect(formatShortDate('2026-12-05')).toBe('05/12');
    });
  });

  describe('formatTime e formatTimeRange', () => {
    it('mantém strings já no formato HH:mm', () => {
      expect(formatTime('09:30')).toBe('09:30');
      expect(formatTime('18:00')).toBe('18:00');
    });

    it('extrai horário HH:mm a partir de string ISO 8601 no fuso America/Sao_Paulo', () => {
      // 12:30 UTC = 09:30 em America/Sao_Paulo (-03:00)
      const iso = '2026-09-24T12:30:00.000Z';
      expect(formatTime(iso)).toBe('09:30');
    });

    it('formata intervalo de horários', () => {
      const range = formatTimeRange('2026-09-24T12:00:00.000Z', '2026-09-24T12:45:00.000Z');
      expect(range).toBe('09:00 - 09:45');
    });
  });

  describe('addDays', () => {
    it('adiciona dias mantendo o formato YYYY-MM-DD', () => {
      expect(addDays('2026-09-24', 1)).toBe('2026-09-25');
      expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
      expect(addDays('2026-09-24', -1)).toBe('2026-09-23');
    });
  });

  describe('getWeekdayLabel', () => {
    it('retorna os dias da semana em português', () => {
      expect(getWeekdayLabel('MONDAY')).toBe('Segunda-feira');
      expect(getWeekdayLabel('FRIDAY')).toBe('Sexta-feira');
      expect(getWeekdayLabel('SATURDAY')).toBe('Sábado');
      expect(getWeekdayLabel('SUNDAY')).toBe('Domingo');
    });
  });
});
