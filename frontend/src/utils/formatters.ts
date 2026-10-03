import type { Weekday } from '../types/api.js';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Formata um valor em centavos inteiros para moeda brasileira (R$).
 * Ex: 8500 -> "R$ 85,00"
 */
export function formatCurrency(priceInCents: number): string {
  if (isNaN(priceInCents) || priceInCents < 0) {
    return 'R$ 0,00';
  }

  const value = priceInCents / 100;
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Converte uma entrada em reais (string ou número) para valor inteiro em centavos.
 * Suporta formatos: "85", "85,00", "85.00", "1.250,50", "R$ 85,00".
 */
export function parseReaisToCents(value: string | number): number {
  if (typeof value === 'number') {
    if (isNaN(value) || value < 0) return 0;
    return Math.round(value * 100);
  }

  if (!value || typeof value !== 'string') {
    return 0;
  }

  let cleaned = value.trim().replace(/^R\$\s?/, '');

  if (!cleaned) {
    return 0;
  }

  // Se tiver tanto ponto quanto vírgula (ex: 1.250,50)
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // Apenas vírgula decimal (ex: 85,50)
    cleaned = cleaned.replace(',', '.');
  }

  const num = parseFloat(cleaned);
  if (isNaN(num) || num < 0) {
    return 0;
  }

  return Math.round(num * 100);
}

/**
 * Formata data no formato YYYY-MM-DD para visualização por extenso em português.
 * Ex: "2026-09-24" -> "Quinta-feira, 24 de setembro de 2026"
 */
export function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const formatted = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Formata data no formato YYYY-MM-DD para formato curto: "DD/MM".
 */
export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

/**
 * Extrai o horário (HH:mm) de uma string ISO ou mantém caso já seja HH:mm.
 */
export function formatTime(isoOrTime: string, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!isoOrTime) return '';

  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(isoOrTime.trim())) {
    return isoOrTime.trim();
  }

  try {
    const date = new Date(isoOrTime);
    if (isNaN(date.getTime())) return isoOrTime;

    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return isoOrTime;
  }
}

/**
 * Formata um intervalo de início e término em formato legível: "09:00 - 09:45".
 */
export function formatTimeRange(
  startsAt: string,
  endsAt: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const start = formatTime(startsAt, timeZone);
  const end = formatTime(endsAt, timeZone);
  return `${start} - ${end}`;
}

/**
 * Retorna a data atual no formato YYYY-MM-DD no fuso horário especificado.
 */
export function getTodayDateString(timeZone: string = DEFAULT_TIMEZONE): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  });
  return formatter.format(now);
}

/**
 * Adiciona ou subtrai dias de uma data YYYY-MM-DD.
 */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Retorna a segunda-feira da semana de uma data YYYY-MM-DD.
 * A semana começa rigorosamente na segunda-feira.
 */
export function getWeekStart(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = date.getUTCDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDays(dateStr, diffToMonday);
}

/**
 * Retorna o domingo da semana de uma data YYYY-MM-DD (fim da semana).
 */
export function getWeekEnd(dateStr: string): string {
  const start = getWeekStart(dateStr);
  return addDays(start, 6);
}

/**
 * Retorna a lista dos 7 dias da semana (de segunda a domingo) a partir de uma data.
 */
export function getWeekDays(dateStr: string): string[] {
  const start = getWeekStart(dateStr);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * Adiciona ou subtrai semanas de uma data YYYY-MM-DD.
 */
export function addWeeks(dateStr: string, weeks: number): string {
  return addDays(dateStr, weeks * 7);
}

/**
 * Formata o intervalo da semana em texto legível para o cabeçalho.
 * Ex: "21 a 27 de setembro de 2026", "28 de setembro a 4 de outubro de 2026"
 */
export function formatWeekRangeDisplay(dateStr: string): string {
  if (!dateStr) return '';
  const mondayStr = getWeekStart(dateStr);
  const sundayStr = getWeekEnd(dateStr);
  const [mYear, mMonth, mDay] = mondayStr.split('-').map(Number);
  const [sYear, sMonth, sDay] = sundayStr.split('-').map(Number);

  const monthNames = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];

  if (mYear === sYear && mMonth === sMonth) {
    return `${mDay} a ${sDay} de ${monthNames[mMonth - 1]} de ${mYear}`;
  }
  if (mYear === sYear) {
    return `${mDay} de ${monthNames[mMonth - 1]} a ${sDay} de ${monthNames[sMonth - 1]} de ${mYear}`;
  }
  return `${mDay} de ${monthNames[mMonth - 1]} de ${mYear} a ${sDay} de ${monthNames[sMonth - 1]} de ${sYear}`;
}

/**
 * Extrai a data YYYY-MM-DD de uma reserva com fuso horário seguro (America/Sao_Paulo).
 */
export function getAppointmentDateString(
  startsAt: string | Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!startsAt) return '';
  const date = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (isNaN(date.getTime())) {
    return typeof startsAt === 'string' ? startsAt.split('T')[0] : '';
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  });
  return formatter.format(date);
}

/**
 * Determina se a reserva ocorre no dia YYYY-MM-DD especificado.
 */
export function isAppointmentOnDate(
  startsAt: string | Date,
  dateStr: string,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  return getAppointmentDateString(startsAt, timeZone) === dateStr;
}

/**
 * Mapeia o enum Weekday para o nome legível em português.
 */
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MONDAY: 'Segunda-feira',
  TUESDAY: 'Terça-feira',
  WEDNESDAY: 'Quarta-feira',
  THURSDAY: 'Quinta-feira',
  FRIDAY: 'Sexta-feira',
  SATURDAY: 'Sábado',
  SUNDAY: 'Domingo',
};

export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  MONDAY: 'Seg',
  TUESDAY: 'Ter',
  WEDNESDAY: 'Qua',
  THURSDAY: 'Qui',
  FRIDAY: 'Sex',
  SATURDAY: 'Sáb',
  SUNDAY: 'Dom',
};

export function getWeekdayLabel(weekday: Weekday): string {
  return WEEKDAY_LABELS[weekday] ?? weekday;
}
