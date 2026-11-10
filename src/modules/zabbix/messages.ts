export const ZABBIX_UNAVAILABLE = "График Zabbix недоступен.";
export const ZABBIX_NOT_FOUND = "График не найден.";
export const ZABBIX_AMBIGUOUS = "График не однозначен.";
export const ZABBIX_NOT_SERIES = "Этот график Zabbix не линейный.";
export const ZABBIX_NO_ITEMS = "Нет числовых элементов.";

export const ZABBIX_TOO_OLD = "Нужен Zabbix 6.0 или новее.";
export const ZABBIX_NO_VERSION = "Zabbix не назвал версию.";
export const ZABBIX_NO_SESSION = "Zabbix не выдал сессию.";
export const ZABBIX_HOST_NONE = "Хост не найден.";
export const ZABBIX_HOST_MANY = "Найдено несколько хостов.";
export const ZABBIX_GRAPH_NONE = "График не найден.";
export const ZABBIX_GRAPH_MANY = "Найдено несколько графиков.";
export const ZABBIX_HISTORY = "История недоступна.";
export const ZABBIX_SAVE_FIRST = "Сначала сохраните адрес, логин и пароль.";
export const ZABBIX_PASSWORD_UNREADABLE = "Пароль не читается.";
export const ZABBIX_NEED_GRAPH = "Укажите хост и название хотя бы одного графика.";

export function zabbixElementCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "элемент"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "элемента"
        : "элементов";
  return `${count} ${word}`;
}

export function zabbixGraphNotes(input: {
  shown: number;
  total: number;
  mixed: boolean;
  truncated: boolean;
  unread: boolean;
}): string | null {
  const parts: string[] = [];
  if (input.total > input.shown) {
    parts.push(`Показаны ${input.shown} из ${input.total}.`);
  }
  if (input.truncated) parts.push("Часть линий не поместилась в ответ.");
  if (input.unread) parts.push("Часть линий не прочитана.");
  if (input.mixed) parts.push("Разные единицы, одна шкала.");
  return parts.length > 0 ? parts.join(" ") : null;
}
