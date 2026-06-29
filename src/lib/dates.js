export const NEXT_SERVICE_DATE = '2026-07-16';

export function toLocalISO(date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 10);
}

export function getTodayISO() {
  return toLocalISO(new Date());
}

export function isThursday(date) {
  if (!date) return false;
  return new Date(`${date}T12:00:00`).getDay() === 4;
}

export function getNextThursday(fromDate = getTodayISO()) {
  const date = new Date(`${fromDate}T12:00:00`);
  const daysUntilThursday = (4 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntilThursday);
  return toLocalISO(date);
}

export function addDays(date, days) {
  const nextDate = new Date(`${date}T12:00:00`);
  nextDate.setDate(nextDate.getDate() + days);
  return toLocalISO(nextDate);
}

export function getThursdayOptions(extraDates = []) {
  const firstThursday = NEXT_SERVICE_DATE;
  const dates = Array.from({ length: 16 }, (_, index) => addDays(firstThursday, index * 7));

  extraDates.forEach((date) => {
    if (date && isThursday(date) && !dates.includes(date)) {
      dates.push(date);
    }
  });

  return dates.sort();
}

export function formatDate(date) {
  if (!date) return '-';

  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${date}T12:00:00`));
}

export function formatLongDate(date) {
  if (!date) return '';

  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00`));
}

export function formatMoney(amount) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(amount);
}
