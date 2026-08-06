#!/usr/bin/python3
"""
Read-only softswitch export for Reg platform.

SELECT-only against MVTS MySQL (credentials from /etc/mvts3g/access-db.conf).
Emits JSON on stdout with the same decoded fields formerly written to export.xlsx.
Does NOT write any files. Does NOT mutate MySQL.
"""

from __future__ import annotations

import json
import sys

import mysql.connector

ENDPOINT_HEADERS = [
    "Название",
    "Описание",
    "Номер оконечного оборудования",
    "Инициирующее устройство",
    "Терминирующее устройство",
    "Регистрация",
    "Зона",
    "ИНИЦ. список адресов",
    "ИНИЦ. порт",
    "ИНИЦ. зона",
    "ИНИЦ. емкость",
    "Входящие группы",
    "ТЕРМ. список адресов",
    "ТЕРМ. порт",
    "ТЕРМ. зона",
    "ТЕРМ. емкость",
    "Регистрационное имя",
    "Регистрационный пароль",
    "Список разрешенных адресов для регистрации",
]

GATEWAY_HEADERS = [
    "Название",
    "Описание",
    "Инициирующее устройство",
    "Терминирующее устройство",
    "Протокол сигнализации",
    "ИНИЦ. список адресов",
    "ИНИЦ. порт",
    "ИНИЦ. зона",
    "ИНИЦ. емкость",
    "Входящие группы",
    "ТЕРМ. список адресов",
    "ТЕРМ. порт",
    "ТЕРМ. зона",
    "ТЕРМ. емкость",
]


def decode_bool(val):
    if val == 1:
        return "Да"
    if val == 0:
        return "Нет"
    return "Ошибка"


def decode_proto(val):
    if val == 0:
        return "H.323"
    if val == 1:
        return "SIP"
    if val == 2:
        return "SS7"
    if val == 3:
        return "Internal"
    if val == 4:
        return "SIP-T/I"
    return "Ошибка"


def cell(value):
    if value is None:
        return ""
    return value


def load_db_conf(path="/etc/mvts3g/access-db.conf"):
    conf = {
        "host": None,
        "user": None,
        "passwd": None,
        "dbName": None,
    }
    with open(path, encoding="utf-8", errors="replace") as fh:
        for confline in fh:
            p = confline.rstrip("\n").split("=", 1)
            if len(p) != 2:
                continue
            key, val = p[0], p[1]
            if key in conf:
                conf[key] = val
    missing = [k for k, v in conf.items() if not v]
    if missing:
        raise RuntimeError(f"access-db.conf missing keys: {', '.join(missing)}")
    return conf


def resolve_groups(src_group_list, group_dict):
    if src_group_list is None or len(src_group_list) == 0:
        return ""
    parts = []
    for g in src_group_list.split(";"):
        if not g:
            continue
        parts.append(group_dict[g] if g in group_dict else g)
    return ";".join(parts)


def main() -> int:
    conf = load_db_conf()
    conn = mysql.connector.connect(
        host=conf["host"],
        user=conf["user"],
        password=conf["passwd"],
        database=conf["dbName"],
    )
    try:
        query_gr = conn.cursor()
        query_gr.execute(
            "select routing_group_id, routing_group_name from mvts_routing_groups"
        )
        groups = query_gr.fetchall()
        group_dict = {str(r[0]): r[1] for r in groups}

        query = conn.cursor()
        query.execute(
            "select gateway_name, description, equipment_type, src_enable, "
            "dst_enable, reg_type, endpoint_number, src_zone, dst_zone, "
            "ipv4_src_address_list, src_port, src_capacity, src_group_list, "
            "ipv4_dst_address, dst_capacity, dst_port_sip, reg_login, "
            "reg_password, ipv4_reg_address_list, protocol "
            "from mvts_gateway where equipment_type in (1, 6) "
            "order by gateway_name"
        )
        rows = query.fetchall()

        endpoints = []
        gateways = []

        for r in rows:
            gwname = r[0]
            desc = r[1]
            gwtype = r[2]
            is_originator = decode_bool(r[3])
            is_terminator = decode_bool(r[4])
            is_register = decode_bool(r[5])
            ep_number = r[6]
            src_zone = r[7]
            dst_zone = r[8]
            src_addr_list = r[9]
            src_port = r[10]
            src_capacity = r[11]
            src_groups = resolve_groups(r[12], group_dict)
            dst_addr = r[13]
            dst_capacity = r[14]
            dst_port = r[15]
            reg_login = r[16]
            reg_pass = r[17]
            reg_addr_list = r[18]
            proto = decode_proto(r[19])

            if gwtype == 1:
                gateways.append(
                    {
                        "Название": cell(gwname),
                        "Описание": cell(desc),
                        "Инициирующее устройство": is_originator,
                        "Терминирующее устройство": is_terminator,
                        "Протокол сигнализации": proto,
                        "ИНИЦ. список адресов": cell(src_addr_list),
                        "ИНИЦ. порт": cell(src_port),
                        "ИНИЦ. зона": cell(src_zone),
                        "ИНИЦ. емкость": cell(src_capacity),
                        "Входящие группы": src_groups,
                        "ТЕРМ. список адресов": cell(dst_addr),
                        "ТЕРМ. порт": cell(dst_port),
                        "ТЕРМ. зона": cell(dst_zone),
                        "ТЕРМ. емкость": cell(dst_capacity),
                    }
                )
            else:
                # Same zone placement rules as the original xlsx exporter.
                endpoints.append(
                    {
                        "Название": cell(gwname),
                        "Описание": cell(desc),
                        "Номер оконечного оборудования": cell(ep_number),
                        "Инициирующее устройство": is_originator,
                        "Терминирующее устройство": is_terminator,
                        "Регистрация": is_register,
                        "Зона": cell(src_zone) if r[5] == 1 else "",
                        "ИНИЦ. список адресов": cell(src_addr_list),
                        "ИНИЦ. порт": cell(src_port),
                        "ИНИЦ. зона": cell(src_zone) if r[5] == 0 else "",
                        "ИНИЦ. емкость": cell(src_capacity),
                        "Входящие группы": src_groups,
                        "ТЕРМ. список адресов": cell(dst_addr),
                        "ТЕРМ. порт": cell(dst_port),
                        "ТЕРМ. зона": cell(dst_zone) if r[5] == 0 else "",
                        "ТЕРМ. емкость": cell(dst_capacity),
                        "Регистрационное имя": cell(reg_login),
                        "Регистрационный пароль": cell(reg_pass),
                        "Список разрешенных адресов для регистрации": cell(
                            reg_addr_list
                        ),
                    }
                )

        payload = {
            "version": 1,
            "endpointHeaders": ENDPOINT_HEADERS,
            "gatewayHeaders": GATEWAY_HEADERS,
            "endpoints": endpoints,
            "gateways": gateways,
        }
        json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
        sys.stdout.write("\n")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — surface to stderr for job diagnostics
        print(f"export.py error: {exc}", file=sys.stderr)
        raise SystemExit(1)
