# Current Phase — production (v1.91.0)

**Status:** in production. Modules beyond Phase 7: phones, groups, CDR/FTP, enrich, geoip/pstn, geography/operators, VoIPmonitor CDR links, month traffic XLSX export, CDR month switcher, CDR month storage/purge, CDR statistics, client traffic detail, tariffs.  
**Date:** 2026-10-07

## v1.91.0 — Call type column

«Местный», «Междугородный», «Международный», and «Редирект» are one category, «Исходящие». The new stored column «Тип» sits between «Категория» and «Статус» on raw data, phone traffic, geography, operators, and both XLSX sheets. It is filterable. There is no new index.

Type is «Местный», «Междугородный», or «Международный» from the same geography rules. Outgoing and redirect use the B-number. Incoming and phantom use the A-number. «Редирект» is a type of «Исходящие», including when side A is unknown. «Проверка» has type «Проверка». «Нет регистрации» and «Ошибка маршрута» have type «Ошибка» and stay separate categories. «Проверить» has type «Проверить». Phantom keeps category «Фантомный»; its type is the geography, not the word «Фантомный».

An empty duration stores «Неуспешный». «0» is still success. Exact `Service_Parking` with a non-empty duration is «Паркинг», including redirect and check even when a winning disconnect code is present. Phantom on that device is «Успешный» or «Неуспешный».

Only «Исходящие» with type «Междугородный», «Международный», or «Редирект» and status «Успешный» or «Паркинг» get a price and charge. «Исходящие» / «Местный» stores the catalog direction from the B-number and leaves price and charge empty. A failed local call stores no direction. Every other category stores no direction, price, or charge. The МГ/МН total is still the sum of stored charges. Statistics and device slices are unchanged.

The checkbox «Успешные» is status «Успешный» and either «Входящий» or «Исходящие» with type «Местный», «Междугородный», or «Международный». Redirect is excluded. Row colors still follow category and status. A successful redirect stays unfilled. Parking stays blue.

The new migration adds `call_type` and replaces the functions. The v1.90.0 migration stays as shipped. The category backfill rewrites the four old geography labels, fills empty types, and renames stored «Неуспешные». The app does not start until that script exits. `npx prisma migrate deploy` alone leaves the old labels in place.

## v1.90.0 — Parking is a status

Successful calls on exact `Service_Parking` keep their ordinary category and store status «Паркинг». «Местный (П)», «Междугородный (П)», «Международный (П)», and category «Паркинг» are gone. A known side A is «Местный», «Междугородный», or «Международный». An unknown side A with a known side B is «Входящий». «Редирект» and «Проверка» on that device are «Паркинг» too, even when a disconnect code is present. An empty duration stays «Неуспешные» and loses the parking mark. «0» is still success. Phantom stays «Фантомный» with «Успешный» or «Неуспешные». «Нет регистрации» and «Ошибка маршрута» stay their own categories and do not become «Паркинг».

«Паркинг» is blue on «Местный», «Междугородный», «Международный», «Входящий», «Редирект», and «Проверка». The parking checkbox matches that status. Successful non-parking «Проверка» stays yellow. A failed «Проверка» is gray. A call that matches no category rule is «Проверить» and purple, including when it is failed. It is not part of «Ошибки звонков». There is no new checkbox.

«Местный» still stores direction «Местный звонок» with no price or charge. Successful «Междугородный», «Международный», and «Редирект» with status «Паркинг» rate the same way as «Успешный». «Входящий» and «Проверка» stay unrated. Statistics and the detail group «Входящий паркинг» still count the device, not the category text.

The new migration replaces the status function and the rating function. The v1.89.0 migration stays as shipped. The category backfill rewrites the four removed labels and stored «Ошибка», then marks successful redirect and check rows on `Service_Parking`. The app does not start until that script exits. `npx prisma migrate deploy` alone leaves the old labels in place.

## v1.89.0 — Short call category labels

The eight geography labels are shorter. Rules are unchanged. «Исходящий местный» is «Местный», «Исходящий междугородный» is «Междугородный», «Исходящий международный» is «Международный». Parking with a known side A is «Местный (П)», «Междугородный (П)», or «Международный (П)». «Входящий паркинг» is «Паркинг». «Фантомный трафик» is «Фантомный». The traffic filter uses the same phantom label.

«Местный» and «Местный (П)» still store direction «Местный звонок» and leave price and charge blank. The month sheet and the enrich workbook recompute the category, so both sheets use the short names.

«Детализация» groups «МГ/МН» the same way as the other counts, with a narrow no-break space. Zero stays a dash. The «Минуты» cell under «Межгород» keeps its right border.

Stored rows are rewritten by the category backfill after migrate. The v1.88.0 migration stays as shipped. Statistics headers and the detail group «Входящий паркинг» are slice names, not call categories.

## v1.88.0 — Local, intercity, and international call categories

«Исходящий звонок», «Внутренний звонок», and «Исходящий паркинг» are gone. A known side A is «Исходящий местный», «Исходящий междугородный», or «Исходящий международный». The same split on `Service_Parking` is «Паркинг местный», «Паркинг междугородный», or «Паркинг международный». «Входящий звонок» is now «Входящий». An unknown side A stays incoming, incoming parking, phantom, or error.

A local call needs both numbers to be 11 digits starting with 73, 74, or 78, and the longest tariff ABC of each number must share one direction that starts with «г. ». Anything else with a national B-number (73, 74, 78, or 79) is intercity. A B-number outside that shape is international. The month sheet and the enrich workbook recompute the category from the same rule, using the loaded tariff snapshot.

«Исходящий местный» and «Паркинг местный» store direction «Местный звонок» and leave price and charge blank, including failed calls. Successful intercity, international, redirect, and the matching parking categories still take the longest ABC when the B-number is 11 digits starting with 7.

«Детализация» adds «МГ/МН» after «Межгород». The cell is the sum of stored charges for the month's calls whose A-number belongs to that client. Zero is a dash. The yellow total is the sum of those cells.

Stored rows are rewritten by the category and tariff backfills after migrate. The v1.79.0 through v1.87.0 migrations stay as shipped.

## v1.87.0 — Tariff columns on traffic; billing screen and /storage redirect removed

«Телефонный трафик» shows «Направление» after «Переадресация», then «Секунды», «Минуты», and «Стоимость». «Стоимость» stays bold, together with the phone-number columns. «Минуты» are still `CEIL(ceiled seconds / 60)` per call, not stored, and not filterable. A blank duration stays blank. «Цена» is not a column on this screen. Calltrace stays at the end.

«Биллинг звонков» (`/billing`) and its nav item are gone. There is no redirect. The rating function, stored direction, price, and charge, the raw table, and the month and enrich sheets are unchanged.

The old `/storage` page redirect is gone, including the `#cdr-storage` anchor. The month table stays at the bottom of «Настройки» and still loads through `GET /api/storage` and `POST /api/storage/purge`.

## v1.86.1 — Money formatter typechecks on the image build

The two-decimal formatter no longer uses BigInt literals. The image build targets ES2017, and those literals failed `next build` for v1.86.0. Display is unchanged.

## v1.86.0 — Two decimal places for price and charge

«Тарификация» shows «Цена» with two decimal places. «Сырые данные» and «Биллинг звонков» show «Стоимость» the same way. A blank cell stays blank. The stored catalog price still keeps up to six fractional digits; only the table text is rounded to a kopeck.

The month sheet and the enrich traffic sheet write «Цена» and «Стоимость» as numbers with format `#,##0.00`: a thousands separator and two decimal places. An unrated call still leaves those cells blank.

## v1.85.0 — Drop cost and profit

«Себестоимость» is gone from «Тарификация», the tariff snapshot, and the XLSX upload. The file headers are «Направления», «ABC», and «Цена». A file that still has «Себестоимость» does not replace the snapshot. The snapshot already in the database keeps its directions and prices.

«Сырые данные», «Биллинг звонков», the month sheet, and the enrich traffic sheet no longer show «Себестоимость» or «Прибыль». «Направление», «Цена», and «Стоимость» stay. «Стоимость» is still CEIL(seconds/60) × price per minute, ceiled to a kopeck. Successful outgoing, internal, redirect, and parking calls with an 11-digit B-number starting with 7 still rate. A failed call stays blank. «Детализация» never had those columns.

Stored `tariff_cost`, `tariff_profit`, and `tariff_rates.cost` are dropped. The rating function is replaced in a new migration; the v1.79.0 through v1.82.0 migrations stay as shipped. Existing direction, price, and charge cells are not rewritten. API keys still cannot open tariffs.

## v1.84.0 — Seconds label and per-call minutes on billing

CDR screens and the jobs table say «Секунды» where they said «Длительность». The stored field stays `elapsed_time`, and the cell is still `CEIL(ms/1000)`.

«Биллинг звонков» shows «Минуты» after «Секунды». Minutes are `CEIL(ceiled seconds / 60)` per call, the same rule as the month sheet. A blank duration stays blank in both cells. Zero milliseconds stays 0 and 0. The column is not stored and has no filter.

The month sheet writes «Цена» as a number with format `0.00`, the same as «Стоимость», «Себестоимость», and «Прибыль». A blank price stays blank.

## v1.83.0 — Month purge holds the file and clears that month's jobs and audit

Import skips a month for the whole file once that month is the purge target, even if the target clears before the file ends. The file stays on disk without a purge-hold mark when the delete has already finished, so the drain can load it. A restart drops leftover purge-hold marks. Retry keeps the hold only while that month is still being deleted.

After the CDR rows of a month are gone, jobs and audit whose timestamps fall in that UTC month are deleted in batches. The purge job itself stays. Registrations and the phone catalog stay; their link to an old job is cleared by the existing foreign key. «Хранение данных» says so before the operator confirms.

A month sheet writes tariff cells from the database update only when a blank side is filled. Other rows keep the tariff read with the row.

## v1.82.0 — Internal calls have zero cost

A successful «Внутренний звонок» still takes the tariff charge and writes «Себестоимость» `0.00`. «Прибыль» is that charge. This is the same money rule as «Исходящий паркинг». A failed internal call stays blank. The rating function is replaced in a new migration; the v1.79.0 and v1.80.0 migrations stay as shipped. The migrator backfill rewrites stored internal rows on the next deploy.

## v1.81.0 — Remove unused month window and legacy Calltrace rewrite

Month filters, purge, statistics, detail, and the month sheet still use the UTC `cdr_date` prefix. Calltrace links are still official `fcallid` URLs after a confirmed match. The old timezone month window (v1.14 export buttons) and the unused `fId` card rewriter are gone. Screens, filters, and stored links are unchanged.

## v1.80.0 — Call billing

«Биллинг звонков» (`/billing`, `phones:read`) sits in the CDR nav between «Телефонный трафик» and «Операторы связи». The table is the traffic summary without Calltrace. «Направление» follows «Переадресация». «Стоимость», «Себестоимость», and «Прибыль» follow «Секунды». «Стоимость» values are bold on this screen only. «Цена» is not a column here.

The month sheet and the enrich traffic sheet replace «Тариф» with «Цена» from the tariff snapshot (`tariff_price`, the same text as «Тарификация»). «Направление» follows «Сторона В». «Себестоимость» and «Прибыль» follow «Стоимость». «Цена» is text. The three sums are numbers with format `0.00`. An unrated call leaves those cells blank. «Стоимость» values and both phone-number columns are bold on the traffic sheet and on «Детализация» (numbers only; that sheet's columns are unchanged). API keys still cannot download the file. The price column is a new migration; the v1.79.0 rating migration is unchanged. The migrator backfill writes the price on the next deploy.

## v1.79.0 — CDR tariff columns

«Сырые данные» shows Направление, Стоимость, Себестоимость, and Прибыль after Статус. A successful «Исходящий звонок», «Внутренний звонок», or «Редирект» whose B-number is 11 digits starting with 7 takes the longest matching ABC from the tariff snapshot. Equal ABC length keeps the earlier file row. Стоимость is CEIL(seconds/60) × price per minute. Себестоимость is ceiled seconds × cost per minute / 60. «Исходящий паркинг» uses the same charge and writes cost `0.00`. Прибыль is charge minus cost. Money is ceiled to a kopeck toward +infinity and stored with two decimal places. Other category and status combinations stay blank.

The same function fills existing rows at migrate time and again after every successful tariff upload. A bad tariff file does not replace the snapshot and does not start a recompute. New imports and side refreshes that change category, status, B-number, or duration recompute that row. API keys do not receive Себестоимость or Прибыль and cannot filter by them.

## v1.78.0 — Tariff catalog

«Тарификация» sits in the admin nav between «Настройки» and «Задачи». Admin and operator (`phones:read`) can open it. API keys cannot. The table lists Направления, ABC, Цена, and Себестоимость. «Загрузить данные» replaces the whole snapshot from an XLSX with those four headers. A file that fails validation leaves the previous snapshot in place. ABC is a digit fragment of a phone number (leading zeros kept when the cell is text). Price and cost are decimals with up to 6 fractional digits.

## v1.77.0 — Call and minute columns are 80px

«Звонки» and «Минуты» on Детализация and Статистика are 80px wide. Headers stay centered, and numbers in the cells and the totals row stay right-aligned. The Детализация client column still grows from 250px to the longest name. The Статистика name column stays 210px.

## v1.76.0 — Call and minute columns are 70px

«Звонки» and «Минуты» on Детализация and Статистика are 70px wide, and those headers are centered. Numbers in the cells and the totals row stay right-aligned. The Детализация client column still grows from 250px to the longest name. The Статистика name column stays 210px.

## v1.75.0 — Plain «Успешные» checkbox label

The CDR toolbar checkbox «Успешные» is plain 12px text. The transparent badge is gone, so the label no longer takes the colored-mark padding. It stays vertically centered with the checkbox and the neighboring marks. The other row-color checkboxes keep their fills. The success filter is unchanged.

## v1.74.0 — Main column left inset is 16px

The admin main column left padding is 16px, the same as the top inset. The right side stays 24px and the bottom stays 12px.

## v1.73.0 — Section title caps line up with the toolbar buttons

Section titles trim the empty space above the capitals, so the top of the letters meets the top edge of the buttons on the right. Font size stays 20px. The gap between the title and its subtitle stays; that pair’s bottom edge moves up by the trimmed amount. Pages without toolbar buttons use the same trim, so the letters sit on the 16px line.

## v1.72.0 — Main column top inset matches the nav

The admin main column top padding is 16px, the same as the left nav. Side padding stays 24px and the bottom stays 12px. Section title line-height is unchanged, so the letters still sit inside that 16px line.

## v1.71.0 — Section titles are 20px

Page section titles (`h1`) are 20px (`text-xl`, line-height 28px). The muted line under each title stays 14px. Nested `h2` headings stay 16px. Login card title, navigation, and table text are unchanged.

## v1.70.0 — Count line sits 12px above the screen edge

The gap under «Показано … из …» matches the 12px gap above that text. Admin pages use 12px bottom padding; top and side padding stay 24px. Groups, statistics, settings, and enrich share that bottom inset.

## v1.69.0 — 12px table count line

The «Показано … из …» line under tables, including «0 результатов», uses the same 12px as table cells. Top padding and the border stay. The in-scroll «Загрузка…» line stays 14px.

## v1.68.0 — Search field and month menu fit their labels

The «Телефонный номер» field on Registrations, Phones, and CDR toolbars is as wide as that placeholder, with the same gap on the left and the right. Month menus and the Phones section menu are as wide as the widest option plus the arrow slot. The left-nav database size is saturated green.

## v1.67.0 — CDR «Успешные» and plural failed status

CDR toolbars (traffic / geography / operators / raw) put «Проверка» after «Паркинг» and before «Неуспешные», then «Успешные». «Успешные» keeps «Входящий звонок», «Исходящий звонок», and «Внутренний звонок» only when status is «Успешный». The other checkboxes still combine with OR. Stored status «Неуспешный» is now «Неуспешные» in the column, the gray fill, and new month/enrich XLSX. The checkbox row does not filter those exports.

The migrator replaces `cdr_call_status` in place (the trigger still calls it) and rewrites stored «Неуспешный» in primary-key batches of 5000, status only. The app does not start until that script exits. `npx prisma migrate deploy` alone leaves the old status text in place.

## v1.66.0 — 12px search toolbar text

Registrations, Phones, and Traffic search rows use 12px for the phone field, checkbox labels, the reset button, and the section or month select (including the invisible width span). The phone field stays 12px below and above the `md` breakpoint. Checkbox chips keep `leading-none` and medium weight. Control heights are unchanged.

## v1.65.0 — 13px search toolbar text

Registrations, Phones, and Traffic search rows use 13px for the phone field, checkbox labels, the reset button, and the section or month select (including the invisible width span). The phone field stays 13px below and above the `md` breakpoint. Checkbox chips keep `leading-none` and medium weight. Control heights are unchanged.

## v1.64.0 — «Проверка» from the dial object and test sides

«Проверка» is exact `dp_name = Service_Check`, or `side_a` / `side_b` starting with `Тест ` (the space is part of the prefix; `Тест` and `Тест_1` do not match). Terminating `dst_name = Service_Check` is no longer «Проверка». «Редирект» still wins. The checkbox, row fill, and month/enrich XLSX follow the stored category and the same TypeScript rule.

The migrator replaces `cdr_call_category` with a six-argument function (`dp_name` last), points the existing trigger at it, then drops the five-argument function. It rewrites old `dst_name = Service_Check` rows through the indexed pass, then walks the primary key once for `dp_name = Service_Check` and sides `Тест …`. The app does not start until that script exits. `npx prisma migrate deploy` alone leaves old rows unchanged.

## v1.63.0 — No «Редирект» checkbox

The CDR toolbar checkbox «Редирект» and its list filter are gone. Category «Редирект» is still stored and shown. A successful redirect row has no fill; a failed one stays gray. The other five checkboxes, row colors, and the label backfill are unchanged.

## v1.62.0 — CDR toolbar filters follow category and status

«Фантомный звонок» is stored as «Фантомный трафик». Status «Удачный» is «Успешный»; «Неудачный» is «Неуспешный». Classification rules are unchanged: empty `elapsed_time` is failed, `0` is success.

CDR toolbars (traffic / geography / operators / raw) drop «Недозвон». Six checkboxes match stored columns and combine with OR: «Фантомный трафик», «Ошибки звонков» («Ошибка маршрута» and «Нет регистрации» only), «Паркинг» (incoming and outgoing parking on `dst_name`), «Редирект» (no fill), «Неуспешный», «Проверка». Table rows and month/enrich XLSX use the same fills. Gray is only «Неуспешный» when the category has no color of its own. A missing enrich `elapsedTime` stays «Успешный».

The migrator rewrites old labels in primary-key order, 5000 rows at a time, then `ANALYZE` if it changed anything. The new app does not start until that script exits. `npx prisma migrate deploy` alone leaves the old labels in place.

## v1.61.0 — Extra call categories, billing hyphen, database size

Four categories are checked before parking and direction: «Редирект» (`src_name` starts with `Redirect_`), «Проверка» (exact `dst_name = Service_Check`), «Нет регистрации» (`Class4, 1 - Unregistered IP Address`), «Ошибка маршрута» (`Class4, 40 - Gateway Is Invalid`). The migrator rewrites every stored «Нет в биллинге» side to `-` and recomputes categories. `-` is an unknown side, same as `""`. Blue miss text stays on side A/B only. Month and enrich XLSX use the same labels and write the hyphen as text.

The left-nav clock block adds «БД» with the whole project database size (`pg_database_size`), always in gigabytes with one decimal. It refreshes once a minute while the tab is visible.

## v1.60.0 — CDR category and status

Each CDR row stores «Категория» and «Статус». A side counts as filled only when it is a billing description (`""` and «-» are undefined). Parking is exact `dst_name = Service_Parking`. Both sides filled on parking is «Исходящий паркинг». Empty `elapsed_time` is «Неудачный»; `0` is «Удачный».

A `BEFORE INSERT OR UPDATE` trigger writes the columns, including when sides are refreshed. The migration adds the columns and functions only. The migrator then fills existing rows in batches of 5000 and drops the temporary partial index. `npx prisma migrate deploy` alone leaves old rows blank.

Traffic, Geography, and Operators show the columns after «Время». Raw data shows them first. Month export and enrich XLSX write them after «Время» on both sheets. Row colors and the phantom / error / parking / no-answer filters are unchanged.

## v1.59.0 — 12px table text

All data tables use 12px (`text-xs`) for cells and headers. Local `text-sm` overrides are gone so Registrations, Phones, Traffic, Audit, Jobs, and API keys match the shared Table primitive. Header row is `h-7`, body cells `py-0.5`; Stats/Detail sticky second headers use `top-7`. Column-filter header labels are 12px. Settings «API-ключи» heading matches other in-page `h2` (`text-base font-semibold`). Buttons inside cells stay `size="sm"`.

## v1.58.0 — Number and description in the registration detail sheet

The right-hand registration card summary shows «Номер» above «Канальность» and «Описание» after it. Values come from the existing detail payload (`current.phone`, `current.description`); empty description is «—». Table columns, filters, and XLSX are unchanged.

## v1.57.0 — Four display timezones, sidebar back to 141.25px

Settings «Часовой пояс дат» keeps UTC, Калининград (UTC+2), Москва (UTC+3), and Новосибирск (UTC+7). Stored `Asia/Krasnoyarsk` still resolves to Novosibirsk; other removed zones fall back to Moscow. Left-nav sidebar content width returns to 141.25px (`Телефонные номера`). Live UTC date, sister-product links, and civil-clock CDR cells / XLSX are unchanged.

## v1.56.0 — UTC date and sister-product links in the left nav

Left-nav clocks add a live UTC calendar day (`17 сентября`) above `UTC` / `UTC+N`. The date comes from UTC getters, not the Settings display timezone. Right-hand values stay bold. Sidebar content width is 150px so `UTC+12` + `31 сентября` is not clipped.

Between «Статистика» and «Настройки»: «Свободные номера» (`https://did.finenumbers.com/`) and «Ресурс нумерации» (`https://pstn.finenumbers.com/`), each in a new tab. Operator still sees the pair before «Задачи». Tick and civil-clock CDR cells / XLSX are unchanged.

## v1.55.0 — Tighter left-nav vertical spacing

Left-nav items use `py-1` and `gap-0.5` instead of `py-1.5` / `gap-1`. Group separators are `my-1.5`; the separator under the logo is `mb-2`. Font, item size (`text-sm` / 14px), sidebar width, logo padding, and the clocks / «Выйти» footer are unchanged.

## v1.54.0 — Unregistered count on the checkbox

«Без регистрации (N)» on «Регистрации» and «Телефонные номера» → «Транки с регистрацией» shows live Unregistered rows from `reg_current`. N comes from the Registrations snapshot (`GET /api/regs/status`); manual «Загрузить данные» writes it from status before the wait snapshot and again after a successful list reload. Successful scheduled polls refresh the badge; the list reloads only when `lastSuccessAt` changes. Filters, row paint, and the phones catalog «без рег.» subtitle are unchanged.

## v1.53.0 — Детализация and Статистика between CDR and Settings

Left nav puts «Детализация» and «Статистика» in their own group after the CDR block (traffic / operators / geography / raw), with a separator above and another before «Настройки». Admin after that is Настройки / Задачи / Аудит. Operator still sees Задачи after the second separator (Настройки / Аудит stay hidden). Permissions and routes are unchanged.

## v1.52.0 — Release tag on the logout button

The standalone `v{package.json}` line under the left-nav clocks is gone. The outline «Выйти» button reads «Выйти - v1.52.0»: button type for the action, the previous `text-xs font-normal text-muted-foreground` for the tag. `aria-label` stays «Выйти». Clocks and logout are unchanged.

## v1.51.0 — Sidebar clocks labeled UTC / UTC+N

Left-nav clocks are two `text-sm` rows: `UTC: HH:mm:ss` and `UTC+N: HH:mm:ss`. N is the fixed Settings display-timezone offset (`UTC` when that zone is selected). The «Время UTC» / «Местное время» stacks are gone. Tick, civil-clock CDR cells / XLSX are unchanged.

## v1.50.0 — CDR month storage lives on Settings

«Хранение данных» is a section at the bottom of `/settings` (after API keys): month table, totals, oldest-complete-month delete. The admin nav item and `/storage` page are gone; `/storage` still requires `settings:write` and redirects to `/settings#cdr-storage`. The snapshot loads on the client (`GET /api/storage`) so Settings SSH/keys do not wait on the full-table month `GROUP BY`. `POST /api/storage/purge`, `cdr.purge.month`, and civil-clock CDR cells / XLSX are unchanged.

## v1.49.0 — Live clocks in the left nav footer

UTC and local time sit in the left navigation footer (above the version and «Выйти») on every admin page, as two `text-sm` stacks: «Время UTC» / «Местное время». They are gone from CDR table headers. Local time still follows the Settings display timezone. Civil-clock CDR cells / XLSX are unchanged.

## v1.48.1 — CDR header clocks on one 14px line

CDR tables (traffic / operators / geography / raw) show UTC and local time as one `text-sm` line next to the title: «Время UTC: HH:mm:ss Местное время: HH:mm:ss». The two-line 12px stack and header `pt-1.5` are gone. Tick, Settings timezone, and civil-clock CDR cells / XLSX are unchanged.

## v1.48.0 — Live UTC and local clocks on CDR table headers

CDR tables (traffic / operators / geography / raw) show two live `HH:mm:ss` lines next to the title: «Время UTC» and «Местное время». Local time uses the Settings display timezone; both lines share one workstation `Date.now()` snapshot. Detail, table cells, and XLSX stay civil-clock from the CDR file.

## v1.47.3 — Badge chrome on row-color checkboxes

Toolbar labels «Фантомный трафик», «Ошибки звонков», «Паркинг», and «Недозвон» on CDR tables (traffic / geography / operators / raw) use the same pill chrome as the Registrations «Статус» badge (`h-5`, `rounded-4xl`, `px-2`), with 14px text. «Без регистрации» on «Регистрации» and «Телефонные номера» → «Транки с регистрацией» matches. Row fills stay the same pastel tones. Filters, row paint, and XLSX are unchanged.

## v1.47.2 — Traffic status uses the month-count cache

`GET /api/traffic/status` still returns `recordCount`. The extra full-table `COUNT(*)` on every 4s poll is gone; the number is the sum of the existing 60s month-count cache (`cdr_day`). Import and purge already invalidate that cache. Filters, row paint, and XLSX are unchanged.

## v1.47.1 — Color plates on row-color checkboxes

Toolbar labels «Фантомный трафик», «Ошибки звонков», «Паркинг», and «Недозвон» on CDR tables (traffic / geography / operators / raw) use a solid `rounded-sm` plate in the same base fill as the matching row. «Без регистрации» on «Регистрации» and «Телефонные номера» → «Транки с регистрацией» uses the unregistered row tint. The v1.47.0 highlighter stroke is gone. Filters, row paint, and XLSX are unchanged.

## v1.47.0 — Marker legend on row-color checkboxes

Toolbar labels «Фантомный трафик», «Ошибки звонков», «Паркинг», and «Недозвон» on CDR tables (traffic / geography / operators / raw) get a highlighter stroke in the same base fill as the matching row. «Без регистрации» on «Регистрации» and «Телефонные номера» → «Транки с регистрацией» uses the unregistered row tint. Filters, row paint, and XLSX are unchanged.

## v1.46.1 — Канальность is the raw catalog capacity

«Канальность» copies `phone_endpoints.data["ИНИЦ. емкость"]` as stored in «Телефонные номера». An empty / whitespace-only field and a registration with no catalog row are both empty («—», empty facet / XLSX cell). The synthetic fallback is gone.

## v1.46.0 — Канальность on Registrations

«Регистрации» adds «Канальность» between «Телефон» and «Описание». Values come from `phone_endpoints.data["ИНИЦ. емкость"]` when the SIP number matches. Column filters, mutual facets, detail sheet, and the full-table XLSX export include the column. Toolbar phone search is unchanged.

## v1.45.0 — Gray «Недозвон» rows and checkbox

CDR tables (traffic / geography / operators / raw) paint a row gray when side A or B is a known catalog description, «Секунды» is empty (`elapsed_time === ""`), and the row is not phantom / parking / call-error. Toolbar checkbox «Недозвон» keeps that class (OR with the other three). Month XLSX uses the same fill (`#E5E7EB`); `seconds === 0` alone is not empty. The hint under traffic export buttons is gone.

## v1.44.0 — Month XLSX fill note and OOXML regression

«Сохранить данные» still writes the whole selected month. Row fills stay the three table classes (phantom / parking / call-error); blue «-» text is independent. A short hint under the traffic export buttons states that. Tests now assert solid `applyFill` xfs in `styles.xml`, not only the ExcelJS cell getter. Writer unchanged.

## v1.43.0 — Green phantom traffic rows

CDR tables (traffic / geography / operators / raw) paint phantom rows green (`bg-green-200`) instead of gray. Month and enrich XLSX use the same fill (`#BBF7D0`). Classification is unchanged: both billing numbers filled, both sides «-». Parking stays blue; call-error stays light red.

## v1.42.0 — Parking checkbox on CDR tables

CDR toolbar (traffic / geography / operators / raw) adds «Паркинг» next to «Фантомный трафик» and «Ошибки звонков». It keeps rows classified as parking-known: «Объект набора» is `Service_Parking` and side A or B is a known description. Combines with the other two flags by OR; reset and column facets keep the flag.

## v1.41.0 — Blue parking rows with a known side

CDR tables (traffic / geography / operators / raw) paint a row blue when «Объект набора» is exactly `Service_Parking` and side A or side B is a known catalog description. Phantom stays gray (both sides «-»); call-error stays light red. Month and enrich XLSX use the same blue fill (`#BFDBFE`). No new toolbar filter.

## v1.40.0 — Unregistered rows on Registrations

«Регистрации» paints `Unregistered` rows with the same light red as «Транки с регистрацией» (`bg-destructive/10`; selected stays `bg-destructive/20`). The «Не зарегистрирован» badge is saturated red (`bg-red-600`), pairing the green Registered badge. XLSX uses the same `#FEE2E2` row fill as phones. Filters, poll, and API are unchanged.

## v1.39.0 — Unregistered checkbox on Registrations

«Регистрации» gets the same toolbar checkbox «Без регистрации» as «Телефонные номера»: one click keeps `reg_current` rows with status Unregistered. List and facets share `unregisteredOnly` (AND with phone search and column filters). Reset, infinite scroll, and poll keep the flag. XLSX export stays a full snapshot.

## v1.38.1 — Drop the detail page footnote

`/detail` no longer shows the operator explainer under the table (client = Описание, independent slices, parking ⊂ incoming, totals ≠ unique CDRs).

## v1.38.0 — Client traffic detail after raw CDR

«Детализация» (`/detail`, `phones:read`) sits in CDR nav after «Сырые данные». One row per current catalog **Описание** (all its endpoint numbers). Month switcher; independent slices: incoming (B-number), outgoing `PSTN_*_Local`, incoming parking (`Service_Parking` on B), external `Trunk_*`, long-distance `PSTN_*_LDC` / `_OLD`. Same call can be outgoing for A and incoming for B. Minutes are per-call `CEIL(CEIL(ms/1000)/60)`. Sort the full table (client A–Z, or a group by minutes desc); infinite scroll 100; sticky header; «Итого» from the whole snapshot; zeros are «-». Client column is at least 250px and sized to the longest name. SQL joins trimmed catalog numbers to `bill_ani` / `bill_dnis` (not `side_*`). No new tables or indexes.

## v1.37.3 — Stats totals bold; platforms table matches SIP chrome

All «Итого» cells on `/stats` are bold. **Технологические платформы** uses the same two-level header and column widths as the SIP tables: **Входящий трафик** / **Исходящий трафик** × Звонки/Минуты (name 210px, metrics 90px). Minutes stay bold; «Итого» minute cells stay yellow.

## v1.37.2 — Fixed SIP stats column widths

«Присоединение» / «SIP-транк» are 210px; every «Звонки» and «Минуты» column is 90px (`table-fixed` + colgroup). Platforms table is unchanged.

## v1.37.1 — Jobs expanded message

Successful job rows no longer expand to empty «Сообщение» / «Код выхода». The panel writes a short operator sentence from counters and `meta`. Zero `cdr.sides.refresh` reads as «Без изменений»; enrich stats are Russian (кэш / запросы).

## v1.37.0 — Readable Jobs results

«Задачи» shows human action names and operator-facing result lines. `GET /api/jobs` returns sanitized `meta`; the summary uses per-action counter meaning (import skipped rows are «уже в базе», VoIPmonitor skip/empty-queue are not a silent success). Expanded row lists whitelisted details, not raw JSON.

## v1.36.0 — VoIPmonitor match findFirst flake; Jobs status filter

`voipmonitor.match` no longer dies on the Prisma `cdrRecord.findFirst` existence-check (same predicate is raw SQL + a short transient retry). Jobs list probes cannot 500 `GET /api/jobs`; `errorMessage` is truncated on read; the status filter uses one request and a successful poll clears the red banner.

## v1.35.0 — Grouped SIP stats; minutes highlight; table chrome

«Внешняя нумерация» uses the same two-level header as ТфОП (Входящий/Исходящий трафик, Входящий паркинг, Фантомный трафик × Звонки/Минуты) **without Межгород**. Minutes on both SIP tables are bold; «Итого» minute cells are bright yellow. Data tables (stats, storage, API keys) have no `rounded-md border` card — same chrome as CDR traffic.

## v1.34.0 — Join Local/LDC PSTN rows on ТфОП stats

«Присоединения к ТфОП» uses a two-level header (Присоединение + grouped Звонки/Минуты). One row per logical `PSTN_*` name with `_Local`/`_LDC` stripped. Incoming / outgoing / incoming parking / phantom come from `*_Local` or unsuffixed `PSTN_*`. **Межгород** is outgoing calls/minutes of the paired `PSTN_*_LDC` only. The separate LDC table is gone. `GET /api/stats` drops `pstnLdc` and adds `ldcCalls`/`ldcMinutes` on `pstnTfop` rows. Parking formula is unchanged (`src` SIP trunk → `Service_Parking`).

## v1.33.0 — Incoming parking and phantom columns on SIP stats

«Статистика» table order: ТфОП, внешняя нумерация, LDC, platforms. ТфОП and внешняя нумерация add **Входящий паркинг** / **Минуты паркинга** / **Фантомный трафик** / **Минуты фантома**. Parking = initiating SIP trunk (`PSTN_` / `Trunk_`) and terminating `Service_Parking`. Phantom = parking plus both stored sides «-» (not the `/traffic` phantom filter). Empty cells stay «-».

## v1.32.0 — Split SIP stats tables; dash for empty counts

«Статистика» splits SIP trunks into **Присоединения к ТфОП** (`PSTN_*` except `_LDC`, including `_Local` and unsuffixed), **Междугородняя и международная связь** (`PSTN_*_LDC`), and **Внешняя нумерация** (`Trunk_*`). Empty call/minute cells (including totals) show «-», not `0`. Platforms table is unchanged.

## v1.31.0 — CDR statistics; storage seconds and billable minutes

«Статистика» (`/stats`, `phones:read`) sits in admin nav between Настройки and Хранение данных. Month switcher plus two summaries: SIP trunks (`PSTN_` / `Trunk_`) and platforms (`Service_` / `Platform_`). Initiating device → inbound, terminating → outbound; a call that matches several categories is counted in each. Minutes are `CEIL(CEIL(ms/1000)/60)` per call (same as XLSX). `/storage` adds **Кол-во секунд** (`SUM` of per-call `CEIL(ms/1000)`) and uses the same per-call minutes — not total seconds / 60.

## v1.30.0 — CDR month storage

Admin «Хранение данных» (`/storage`, `settings:write`) lists stored CDR months (calls + minutes) and deletes only the oldest complete UTC month, one at a time (`cdr.purge.month`). Current month is never deletable. Batched `DELETE` on `cdr_date LIKE`; month dropdown counts come from a 60s cache of `GROUP BY left(cdr_day, 7)`. Import rejects rows without civil date/time; poison/hold files are listed on «Сырые данные». Purge will not start while `cdr.import` is in flight; rows of the purge target month are held in the inbox (not unlinked) until the job finishes.

## v1.29.1 — GHCR typecheck

Job runtime reads `replay` only after narrowing the processor union so `next build` on GHCR succeeds.

## v1.29.0 — CDR side labels follow the phones catalog

«Сторона А/В» in traffic still search the whole selected month on stored `side_*`. When a phone’s Описание appears or changes, job `cdr.sides.refresh` writes the new label onto matching `bill_ani` / `bill_dnis` (all months). Settings toggle + interval; first run ~15s after deploy if no snapshot yet; always runs after a successful `phones.sync` or `cdr.import`. Empty catalog does not wipe sides. Facets and filters stay unchanged.

## v1.28.0 — Time sort in Date context; fewer facet reloads

Time sort is server `ORDER BY cdr_date, cdr_id` (full UTC chronology for the month, not clock-across-days). The first Time click (desc) matches the default list and does not refetch. Header facet menus (traffic / phones / regs) do not reload when only the open column’s chips change or the parent re-renders.

## v1.27.1 — GHCR typecheck

ExcelJS `Row.values` is a union; the Date/Time header assertion now reads cells via `getCell` so `next build` on GHCR succeeds.

## v1.27.0 — Time sort and Date facet order

Time on traffic / geography / operators sorts by clock (`cdr_time`, then `cdr_date`, `cdr_id`) with up/down only — no facet menu. Date facet chips stay in increasing calendar order. Enrich and month XLSX write **Дата** / **Время** instead of «Время звонка»; billing-miss labels are blue in the table and XLSX. `/raw` still has a single `cdr_date`.

## v1.26.0 — CDR date and time columns

Traffic / geography / operators replace «Время звонка» with **Дата** (`30.08.2026`) and **Время** (`14:22:52`). Import writes `cdr_day` / `cdr_time` from `cdr_date` (same slice as the SQL backfill). Mutual column facets stay AND/OR/`excludeColumn`. Phantom rows are darker gray; call-error rows are a stronger red. `/raw` and month XLSX keep a single `cdr_date`.

## v1.25.0 — phantom traffic and empty billing numbers

CDR tables (traffic / geography / operators / raw) color phantom rows gray (both billing numbers filled, both sides «-») and call-error rows red (both `bill_ani` / `bill_dnis` exactly `""`). Toolbar checkboxes filter those classes together with month, phone search, and column facets. Header-menu search for «пусто» finds the empty-string group. Month and enrich XLSX fill the same rows.

## v1.24.0 — case-insensitive traffic search

Header-menu facet search and the toolbar phone search on traffic / geography / operators / raw use Prisma `contains` with `mode: "insensitive"`. Phones and registrations facet search already compared via `toLowerCase()`.

## v1.23.0 — CDR month switch clears column filters; facet search matches the table

Changing the traffic / geography / operators / raw month `<select>` clears column facet chips (phone search stays). Header-menu search for `cdr_date` and duration accepts the on-screen text (`28.12.2026`, `10` seconds), not only the raw stored string.

## v1.22.0 — parked VoIPmonitor hint and two traffic saves

On «Задачи» exhausted VoIPmonitor misses (sentinel `next_attempt_at`) leave the yellow banner. Open leftovers stay `total − with URL − parked`; the due queue is a raw `SELECT 1` (v1.36.0). Parked count is a muted hint on the status filter row (`Не найдены в VoIPmonitor: N`).

On «Телефонный трафик» «Сохранить данные» writes one month sheet; «Сохранить расширенные данные» keeps month + «Детализация». Enrich «Обогащение данных» still writes two sheets. Repeat `cdrAt` sync skips already-aligned rows.

## v1.21.0 — save traffic XLSX for the selected month

On «Телефонный трафик» one button «Сохранить данные» exported the two-sheet enrich XLSX for the UTC calendar month currently selected in the dropdown. The first sheet is named after that month (no «неполный» suffix). v1.22.0 split that into basic (one sheet) and extended (two sheets).

## v1.20.0 — CDR calendar month switcher

Traffic, operators, geography and raw share a month `<select>` on the phone-search row (right-aligned, «Август 2026 года»). Default / refresh / reset is the current UTC calendar month of `cdr_date`. Phone search and column facets AND with that month; the option list is a cheap MIN/MAX calendar, not DISTINCT on every keystroke.

## v1.19.2 — CDR UI after VoIPmonitor queue filter

Exhausted «not found» rows park on a far-future `next_attempt_at` instead of a `LIKE` on `evidence_json`. Matcher and Jobs stop scanning `cdr_records` on every tick, so traffic / geography / operators / raw stay responsive. v1.22.0 hides parked leftovers from the yellow banner (`total − with URL − parked`) and shows them as a quiet filter-row hint.

## v1.19.1 — GHCR typecheck

Jobs poll timer is a DOM `number`, matching «Телефонный трафик», so `next build` on GHCR succeeds.

## v1.19.0 — share exact VoIPmonitor links

Exact Call-ID match writes a Calltrace URL even if another Satel row already claimed that VM call. «Not found» misses stop after 12 attempts so `/jobs` does not spin; the Jobs list and enrich banner refresh while the tab is visible.

## v1.18.0 — separate phones/groups schedule

Registrations keep `regsPollEnabled` / `regsPollIntervalSec`. Phones and incoming groups use `exportSyncEnabled` / `exportSyncIntervalSec` (one `export.py` at a time, alternating). The two loops do not share a tick. Default export interval is 300s and off until enabled.

## v1.17.0 — scheduled phones/groups and Jobs enrich banner

Settings «Регулярная загрузка» now also schedules `phones.sync` and `groups.sync` on the same interval (one `export.py` at a time, alternating). `/jobs` shows PSTN/GeoIP backlog next to VoIPmonitor. Traffic inbox banner waits for two or more pending files so a single in-flight import stays quiet.

## v1.16.1 — match visibility and PSTN retry

Successful VoIPmonitor matches always write at least `legs.in` (conf-only / unclassified fallback no longer leave Calltrace empty). VM rows without `cdrId` are reserved by `callId|callDate` so two CDRs cannot share one call. PSTN live API errors no longer fake a not-found hit, so `enrichedAt` stays null and backfill retries.

## v1.16.0 — VoIPmonitor in/out legs

Matcher stores both Satel signaling legs (in/out Call-ID) as official `fcallid` links. `/raw` shows **VoIPmonitor In/Out** after `cdr_id`; «Телефонный трафик» shows **Calltrace In/Out** after «Код завершения». Migration adds `voipmonitor_legs` and deletes existing links so `voipmonitor.match` re-enriches the archive.

## v1.15.0 — VoIPmonitor match throughput

Hour fetch runs 10 parallel `getVoipCalls` slices; archive first pass skips Call-ID probes; fallback no longer verifies via extra API; links are written in one SQL upsert per chunk. One live hour, then archive hours until the 2-minute job budget. Job meta records fetch/probe/match timings.

## v1.14.2 — traffic export directory

Create `/app/data/traffic-export` in the image (owned by `nextjs`) and mount `reg_traffic_export`. Fixes EACCES on month XLSX export.

## v1.14.1 — GHCR typecheck

`formatCount` rejects `null`; CDR import summary now passes a number so Docker/GHCR build succeeds.

## v1.14 — month traffic XLSX export _(superseded by v1.21.0 / v1.22.0)_

Historical: two buttons exported the previous full month or the current incomplete month (Settings timezone). v1.21.0 replaced that with one «Сохранить данные» button for the UTC calendar month selected in the dropdown (no «неполный» suffix). v1.22.0 split basic vs extended sheets. Live `cdr_records`; PSTN/GeoIP gaps filled from cache/API without overwriting stored fields. Progress modal with stages; sheet named after the month.

## v1.13 — operator counts, duration, live loops

Grouped integer counts with U+202F. Softswitch `elapsed_time` is milliseconds: traffic / geography / operators show ceiled seconds after «Переадресация»; VoIPmonitor matcher uses the same conversion. Nav footer shows `v{package.json}`. Isolated live-loop fixes: groups 409 `reason`, empty snapshot vs live table only, FTP save keeps timezone, traffic poll while the tab is visible, enrich resume on 409/412.

## v1.12 — VoIPmonitor links

Isolated matcher in Reg (no Collector runtime). Settings credentials → job `voipmonitor.match` → `cdr_voipmonitor_links` → column **VoIPmonitor** on `/raw` (after `cdr_id`) and `/traffic` (after «Код завершения»). `/jobs` shows unenriched count while backlog remains. Official `fcallid` URL only after confirmed match; archive backfill + retry.

## Goals delivered

1. **Deployment readiness** — Dockerfile multi-stage (`migrator` + `runner`), compose with `db` → `migrate` → `app`, healthchecks, NPM/`proxy` notes, single-replica guidance
2. **Environment validation** — stronger `.env.example`; production rejects placeholder `BETTER_AUTH_SECRET` / example `APP_ENCRYPTION_KEY`; startup validates env; clearer messages
3. **Scheduler safety** — in-process loop always-on; enablement is Settings `regsPollEnabled` only; docs forbid multi-replica polling
4. **Backup / restore** — `docs/backup-and-restore.md` + `scripts/backup-db.sh` (`npm run backup:db`)
5. **Smoke / acceptance** — `docs/smoke-tests.md` + `scripts/smoke-check.sh` (`npm run smoke`)
6. **Hardening polish** — security headers; Better Auth `trustedOrigins` + secure cookies on HTTPS; readiness omits internal details in production; platform baseline ensured on startup
7. **Go-live checklist** — `docs/production-checklist.md`

## Operator surfaces added/updated

| Item                                                       | Purpose                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `migrate` compose service                                  | `prisma migrate deploy` and CDR category backfill before `app` |
| Baseline migration `prisma/migrations/20260806100000_init` | Production schema apply path                                   |
| `/api/healthz` / `/api/readyz`                             | Liveness; env+DB readiness                                     |
| Startup instrumentation                                    | Env assert → baseline seed → admin bootstrap → scheduler eval  |
| `docs/production-checklist.md`                             | Full go-live list + must-not-do                                |
| `docs/backup-and-restore.md`                               | `pg_dump` / restore / encryption key                           |
| `docs/smoke-tests.md`                                      | Automated + UI acceptance                                      |

## Explicitly NOT done in Phase 7

- Leader election / multi-replica safe scheduling
- Enabling auto-poll by default in Settings (`regsPollEnabled` stays false until operator opts in)
- Automated backup daemons / offsite sync products
- Full CSP redesign or WAF
- New business modules or UI redesigns

## Backend architecture unchanged

Allowlist poll path, anti-overlap, SSH key masking, CSRF/rate limits, and Phase 4–6 APIs/UI contracts are unchanged. Phase 7 is ops/deploy polish only.
