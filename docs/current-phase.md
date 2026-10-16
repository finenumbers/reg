# Current Phase — production (v1.136.0)

**Status:** in production. Modules beyond Phase 7: phones, groups, CDR/FTP, enrich, geoip/pstn, geography/operators, VoIPmonitor CDR links, month traffic XLSX export, CDR month switcher, CDR month storage/purge, CDR statistics, client traffic detail, tariffs, Eltex SMG CDR, Eltex SMG syslog.  
**Date:** 2026-10-16

## v1.136.0 — The Dashboard drops the groups card and scrolls under the heading

The home screen no longer draws «Входящие группы». A failed, never-successful, or stale groups sync still raises a line. Phone numbers and routing groups still share one `export.py` and take turns, so each is still allowed four export intervals, with a ten-minute floor. The dashboard no longer reads the stored group count.

The five remaining cards are registrations, phone numbers, traffic, SMG calls, and syslog. They sit in one row when the content area is wide enough to show those titles, and wrap on a narrower window instead of clipping «Телефонные номера» into «Телефонный трафик». Each cell keeps the badge, the counts, the age, and any note in full. The row is above the call charts.

The heading stays put. Alerts, the status row, and both charts scroll underneath it. The snapshot is still one response; nothing is loaded page by page. The 30-second refresh does not jump the scroll position.

There is no new migration.

## v1.135.0 — The Dashboard adds the last hour of concurrent calls

The call chart has a vertical scale. Moving across it shows the minute and how many sessions overlapped. The count is written out on its own line, so a narrow column cannot clip it off the time. A second chart underneath shows the same peak for the rolling last 60 minutes, including the minute that is still open. Just after midnight that hour reaches into the previous evening. Each chart has its own scale and its own maximum.

Both series come from one CDR read. It is still limited to 8 seconds, still shared for 60 seconds, and still refused while the database is being compressed. The extra lookback is at most 59 minutes and does not change the day series. A timeout, an error, or compression leaves both charts empty with a short reason.

There is no new migration.

## v1.134.0 — The Dashboard draws today's concurrent calls

The home screen shows a full-width chart of how many softswitch calls were active during each minute of the current day. The height is the peak overlap inside that minute, not the number of calls that started. One `cdr_records` row is one call. SMG CDR is not added.

The clock is the same civil time as the traffic tables: `cdrAt` and `elapsed_time`. Empty or zero duration is not drawn. A call longer than 24 hours is cut at 24 hours, and a call that started more than 24 hours before midnight is left out. The open minute is included. Minutes after it are left blank. A past minute with no calls is a real zero. A call that is still up carries its level through the minutes where nothing starts or ends.

The sweep stays in Postgres. The app receives at most one row per minute, then fills the quiet minutes. That statement is limited to 8 seconds and is not started while the database is being compressed. A timeout, an error, or compression shows an empty chart with a short reason, never a line of zeros. A successful read is reused for 60 seconds by every open tab. The card snapshot does not include the series and still refreshes on its own 30-second timer.

`GET /api/dashboard/calls` accepts a browser session only. Without `phones:read` it returns hidden and does not read CDR. The chart asks on its own every 60 seconds while the tab is visible.

There is no new migration.

## v1.133.0 — The Dashboard shows what needs attention

`/` still has no menu item. The logo and a fresh login land here. The screen now lists the feeds the signed-in user is allowed to see: SIP registrations, phone numbers, routing groups, softswitch CDR, SMG CDR, and SMG syslog.

A red line appears only when a switched-on loop has failed, has never succeeded, or is older than its own cadence. Registrations use two poll intervals, with a two-minute floor. Phone numbers and routing groups share one `export.py` and take turns, so each is allowed four export intervals, with a ten-minute floor. A running job is not called stale. A switched-off poll is a badge on its card, not an alarm. Unregistered SIP numbers stay on the card and do not raise a line.

CDR and SMG lines follow the same inbox rules as those pages: a purge hold is not poison, and a waiting folder is mentioned from the second ready file, not while an import is already running. Poison on the softswitch side links to «Сырые данные». Syslog uses the status file on the shared volume. A quiet receiver, a dead socket, low disk, or packets from unknown addresses are lines. The card does not walk the syslog tree.

The traffic card shows call counts for the current UTC month. During database compression that number is the last cached count, or a blank with the same compression sentence the other CDR pages use. It is never a fabricated zero. Minutes, SMG month totals, and the VoIPmonitor queue are not on this screen.

`GET /api/dashboard` accepts a browser session only. Machine API keys are rejected. One short in-memory snapshot is shared by open tabs; the page asks again every 30 seconds while it is visible. A user with no module permissions still sees the heading and nothing else.

There is no new migration.

## v1.132.0 — The site root is an empty Dashboard

`/` no longer redirects to Registrations. It shows a Dashboard heading and nothing else. There is no menu item for it. The logo in the navigation panel opens this screen. After login, the default destination is `/`. An explicit safe `next` path is unchanged. Registrations stay at `/regs`. A signed-in user with no module permissions sees this empty screen.

There is no new migration.

## v1.131.0 — Syslog download is a text link

In the syslog table, «Скачать» is the word itself. It uses the same dark semibold text as the stored-size figure above the table. The outline button is gone. The click still fetches that 10-minute file and shows an error on the page when the download fails. The column title is unchanged. A row without a file still has no word.

There is no new migration.

## v1.130.0 — The call tables name the last load, and syslog shows one gateway's stored size

«Телефонный трафик», «География звонков», «Операторы связи», «Сырые данные», and «Звонки на SMG» say «с последней загрузки: » above the table. The elapsed time stays bold and colored. «нет загрузок» is unchanged.

On the syslog page, under «Последние данные (UTC)», a line reads «Объем данных Syslog по узлу». The figure is the size of every saved 10-minute file for the selected gateway, the same kind of size as the «Объем» column. A raw log and its archive both count while a slot is still being appended. A partial archive, a hidden name, a symlink, and any other gateway do not. An empty gateway shows 0 Б. Until the first answer for that gateway arrives, the figure is «…». Changing the gateway clears it at once.

The number is taken from that gateway's directory and kept for 15 seconds, so the four-second refresh does not stat every file. After 15 seconds the previous figure stays on screen while one walk replaces it. Deleting months, or removing the gateway directory, drops the cached figure immediately. A walk that had already started cannot put the old total back.

There is no new migration.

## v1.129.0 — SMG syslog is one cascade, and deleting a gateway removes its files

The syslog page lists one gateway at a time. The table is a cascade: a black cell is the chosen year, month, day or hour, and every column to the right shows only intervals that exist for that choice. Clicking a cell keeps the choice to its left and selects the latest existing value in each column to its right. The minute column lists the 10-minute files and is not itself a choice. Opening the page, changing the gateway, or reloading the page selects the latest year, month, day and hour. Every four seconds the same choice is read again, so sizes and the open interval move without jumping the black cells. Each column is only as wide as its widest cell, including the header. Download still fetches that one 10-minute interval.

«Удаление данных до» removes that gateway's files strictly before a complete month. The current UTC month is not in the list. The chosen month and anything newer stay. The operator confirms first. Only an administrator sees the row. A repeated request for the same boundary deletes nothing further.

Deleting a gateway in Settings now removes its directory as well as the database row. The request waits for the receiver to drop the address, then deletes the directory, then checks once more for a datagram that was already queued. A symlink is removed as a link and its target is left alone. Other gateways, `.status.json` and `.volume-reset` stay. If the directory is still there, Settings keeps a retry for that address. A Docker bridge directory is not removed by this button. Gateways deleted by an older release are not swept.

The column titles in Settings → «Syslog — SMG» are centered.

There is no new migration.

## v1.128.0 — A failed month delete keeps what it already removed

A month delete that has already committed a batch keeps that month held when a later batch fails. The inbox does not put those calls back while this process stays up. A failure before any batch still releases the files. A later failure that has not removed a batch of its own leaves that hold in place. Success releases it. A process restart still releases held files.

While the database is being compressed, «Телефонный трафик», «География звонков», «Операторы связи», «Сырые данные», «Статистика», and «Детализация» do not query those tables. They show the same message as the API. An open traffic tab loads the list once that compression status succeeds. Statistics and detail wait for a reload.

After the syslog socket dies and privileges have been dropped, the process writes the datagrams it already has, then exits so the container can bind port 514 again. A socket error during shutdown does not exit early. Shutdown under a steady stream waits at most five seconds before it closes the socket and syncs. A quiet shutdown still finishes at once. When a slot has both a raw log and an archive, the listed size is the sum of the two files.

A VoIPmonitor row parked for a retryable miss is due after the backoff for its own attempt count. An SMG import that stops without a terminal status is marked failed.

There is no new migration.

## v1.127.0 — Each new SMG syslog datagram is one line, and the volume is cleared once

The first start of this receiver deletes every file and directory in the syslog volume, then writes `.volume-reset`. A later start of this same release leaves the new files in place. The gateway list and the reception switch stay in the database. The socket opens only after that marker is on disk. If the delete fails, the process exits and does not listen.

A new datagram is stored in full, in arrival order. When it does not already end in a line feed, one line feed is written after it. A datagram that already ends in a line feed is not given a second one. Bytes inside the datagram are not changed. An empty datagram is still not stored.

A batch appended to a file that does not end in a line feed starts with one line feed, in the same write as the batch. A failed write truncates that whole write. When a closed archive and a new raw log are merged, or downloaded together, one line feed is inserted between them only if the archive does not already end in one.

There is no new migration.

## v1.126.0 — SMG syslog fsync no longer blocks the socket

The receiver writes and fsyncs each batch on the disk thread pool. The UDP socket keeps being read while that wait runs. Datagrams that arrive during the wait stay in memory, with no cap, and are appended in order after the batch has been synced. A failed write still truncates that batch and tries it again. A failed fsync still syncs the bytes already written and does not write them a second time.

On shutdown the process reads what the kernel has already queued, then closes the socket, then fsyncs. Datagrams still in flight after the socket closes are lost. A disk that stays slower than the arrival rate grows the process memory instead of the kernel drop counter. There is no new migration.

## v1.125.0 — IBM Plex Sans is stored with the app

The production image build downloads IBM Plex Sans from Google Fonts. Google sometimes answers with an address Turbopack cannot parse, and the image is not published. The four faces the UI uses (regular, medium, semibold, bold) now live in the repository under the SIL Open Font License. The build no longer contacts Google Fonts. Latin and Cyrillic stay in those files.

The v1.124.0 image was never published. This release is the one that also listens for SMG syslog on the host network. There is no new migration.

## v1.124.0 — SMG syslog listens on the host network

Every added gateway sends syslog to the same host address and UDP port 514. Docker's published port kept a socket in `dockerd`. A flow that stuck to that socket was discarded, while another gateway was still DNATed into the container. The receiver now listens on the host network, so each datagram takes the same path.

The process starts as root only to bind port 514, then becomes uid 1001 before it writes. New files stay readable by the app. Turning reception off keeps that socket open, because the unprivileged process cannot bind 514 again. Postgres is published only on `127.0.0.1:5432` for this process. It is not published on the public interface. The app and migrations still use the database service name.

A non-empty datagram from an added node is stored in full. There is no queue cap. An unknown address is still not stored. While the container is recreated, UDP has nowhere to go. After the new process is listening, conntrack entries for UDP 514 and 5514 have to be deleted, or they keep steering some gateways at the previous container. The host firewall has to allow UDP 514 from the SMG addresses into the host. The receiver still has no HTTP health check.

There is no new migration.

## v1.123.0 — Each SMG syslog node can carry an identifier

Settings → «Syslog — SMG» stores an identifier beside the display name. A new gateway requires one. A gateway already in the table may keep it empty until an operator sets it while renaming. The value is a lowercase variable: a letter, then letters, digits, or underscore, at most 32 characters. It is unique when set. Empty is stored as NULL, not as a blank string. The migration does not invent identifiers.

Renaming can change the name and the identifier. The address stays. Files stay in the directory of that address. The receiver still reads only the source IP. The identifier is not written into the syslog bytes and does not move folders. The syslog journal still lists devices by address and name.

The gateway list is a table. Each column is as wide as its longest cell. «Последний пакет (UTC)» shows the arrival time as `03:31:06 (15.10.2026)`. The page still reloads that cell every few seconds, and the settings response is not cached. After the receiver process starts again, the cell stays empty until the next datagram.

Migration: `20261015104600_smg_syslog_identifier`.

## v1.122.0 — Keep every SMG syslog datagram, in UTC, byte for byte

New syslog folders are UTC arrival time. The display timezone does not move them. A datagram accepted at 01:59 UTC and written at 02:05 UTC stays in hour 01. The bytes in the file are the UDP payload unchanged. An empty datagram is still not stored. Files already on disk are not rewritten and are not moved out of the hours they were given.

A packet from a registered gateway is always written. A packet whose source is the Docker bridge gateway (`172.x.0.1`) is written under that address too, instead of being counted and dropped. «Syslog» lists that folder as «Мост Docker». Settings keeps the red warning while any such packet has been seen, including when other gateways are already accepted. The folder mixes every gateway until `userland-proxy` is turned off. Any other unknown address is still only counted.

The registry read and gzip no longer stand in front of the write. A failed fsync is retried, and the next batch is still written. Gzip does not take a slot that still has queued datagrams or an open append. A gzip wait that does not finish removes only the partial archive. The raw log stays. The syslog database pool uses a 2 second `statement_timeout`. Status is rewritten every few seconds and includes the real UDP receive buffer. When the kernel clamped it below 16 MiB, Settings says so. The `smg-syslog` container is still not health-checked: a restart would drop whatever is not yet on disk.

«Последний пакет» is explicitly UTC. The folder trail names the selected month, day, and hour, and marks them UTC.

There is no new migration.

## v1.121.0 — Detail drops PSTN_*_OLD, and a missing geo row is not empty

«Детализация» counts long-distance only for `PSTN_*_LDC`. A stored call whose destination is `PSTN_*_OLD` leaves the long-distance columns. It does not move into local or external numbering. A client whose only outgoing calls used that name, and who has no incoming calls, drops off the table, including «МГ/МН». A client with other traffic keeps «МГ/МН». Statistics still shows that name as ordinary ТфОП. Stored calls are not rewritten.

On «Регистрации», the country, city, and provider filter and the visible cells read the geo cache once. A lookup IP with no cache row is not «(пусто)» and does not match a selected country, city, or provider. It stays in the unfiltered list with «—». A cache row with an empty country is still «(пусто)». An address that is not a lookup IP is unchanged. The list still asks for geo only for the current page and does not read the cache a second time. The registration poll still queues every address. The XLSX export is still the full table.

There is no new migration.

## v1.120.0 — A young SMG file waits without a job, and a bad API key does not hide the session

A file that is still inside the two-second settle window no longer waits for the next registration tick, and it does not start `smg.import` while it is young. The scheduler keeps one timer. When the file is ready, one import runs. An empty scan still turns the counter red. A file that is already ready is unchanged.

A scheduled phones or groups export moves to the other script only after the queue accepts that job. A rejected enqueue retries the same script on the next tick. A manual run of both scripts at once is unchanged.

«Загрузить данные» on registrations, phones, and groups, and «Повторить импорт» on softswitch CDR, no longer report the previous success when the status read that should have captured the baseline failed. That read is tried once more before the job is queued. The first run, when nothing has finished yet, is unchanged.

An unrecognized `reg_` key falls through to a valid browser session. A valid key still wins over the cookie. A key that is over its own limit stays limited and does not become the session. Failed guesses are counted per IP, separately from login and from successful keys, and a blocked address is turned away before the key lookup unless a session is present. Permissions stored on a key are reduced to `regs:read` and `phones:read`. A key created in Settings is unchanged.

Deleting a month while the database is being compressed says to wait for that compression. The refusal itself is unchanged.

There is no new migration.

## v1.119.0 — A second SMG CDR banner is not a call

An Eltex upload can append another CDR into the same file: a banner, the 50- or 52-column header, then another banner and header. `20261014161954.cdr` is two empty sections and no calls. The second banner has no semicolons, so import counted it as a call shorter than the header and kept the file.

A line that is only `SMG1016M. CDR. File started at 'YYYYMMDDHHMMSS'` starts the next section. A line that is exactly the 50-column or 52-column header selects that section's columns. Calls after the second banner are loaded. A call row shorter than its header by more than one field is still rejected. A clean file with no calls is deleted, as before.

There is no new migration. The scheduler does not pick up a poisoned file. After deploy, «Повторить импорт» on «Звонки на SMG» clears `20261014161954.cdr`. Calls already stored stay. That empty pass turns the load counter yellow and starts it again.

## v1.118.0 — Save SMG syslog by source address

«Syslog» sits in the SMG block. Settings → «Syslog — SMG» adds each gateway by the IPv4 the UDP packet uses as its source, plus a name. A packet from any other address is not stored. Reception stays off until that switch is on.

A separate `smg-syslog` process binds UDP 5514. Docker publishes `${SYSLOG_PUBLISH_PORT:-514}/udp` to that port. The image health check on port 3000 is disabled for this process, so a quiet receiver is not restarted. The web process only reads the files.

Each accepted datagram is appended to the open 10-minute log and the batch already taken from the socket is synced before the next read. Folders are year, month, day, hour, and a 10-minute slot (`00` … `50`) in the display timezone. When the slot is in the past, the log becomes `50.log.gz`. The raw file is removed only after that archive is synced. The open slot downloads as text. A closed slot downloads as gzip.

The source address must still be the gateway address when it reaches the process. If Docker's userland proxy rewrites it to the bridge gateway, no registered node matches. See the deploy note.

Migration: `20261014180000_smg_syslog`.

## v1.117.0 — An open SMG upload and a held month stay intact

SMG import waits while FTP still has the file open. A file that changes during the read stays in the inbox, and that snapshot is not inserted. An empty file that later has bytes is read on the next pass.

A CDR or SMG file held for a month delete is imported after that delete finishes, including when the hold sentence sits inside a partial-load error. While that month is still being deleted, the file stays in the inbox.

VoIPmonitor decides a finished miss from the `miss_reason` field. Rows already parked at year 9999 whose reason is `assigned_elsewhere` or `fallback_ambiguous` return to the retry queue on the next start. A `call_id_not_in_index` miss stays parked.

There is no new migration.

## v1.116.0 — Unused code removed

Symbols that nothing called are gone. Screens, imports, FTP, month lists, call classification, and the VoIPmonitor result-cap check are unchanged. There is no new migration.

## v1.115.0 — Load counters hold while the feed stays quiet

The RTU and SMG load counters no longer return to zero when the next attempt is the same kind of miss. Another file with no calls leaves the yellow digits on the first empty file of that run. Another scan that finds no file leaves the red digits where they are and only keeps the color. A scan after a file that had calls turns the digits red without zeroing them. A file with calls always starts the counter over, including when the previous file also had calls. An empty file that arrives after a red scan starts a new yellow run. That split is remembered in the process; a restart keeps the digits on the run stored in job history instead of jumping to zero. There is no new migration.

## v1.114.0 — Storage totals and month columns line up

Settings → «Хранение данных» shows CDR and SMG totals in columns: calls, seconds, minutes, and table size. The month table groups «Звонки Satel RTU» and «Звонки Eltex SMG-1016M», each with calls, seconds, and minutes. The month column is as wide as the longest month name. The six number columns share the width of the largest figure. «Удаление» is as wide as the «Удалить» button, or as wide as the header when no month can be deleted. There is no new migration.

## v1.113.0 — SMG counter uses the same colors as softswitch CDR

«Звонки на SMG» keeps the same counter and the same reset rules. The digits are now green after a file that contained calls, yellow after a file with no calls, and red after a later scan that found neither a ready nor a young file in the SMG folder. Several files from different gateways share one counter. The gateway menu does not change it. One pass that takes any file with calls is green. A pass whose files have no calls is yellow. A file that is still being written does not turn the counter red. A quiet gateway does not turn it red while another gateway's file was last or is still in the folder. Green or yellow lasts until the next empty SMG scan, on the same interval as the softswitch scan. The two clocks stay separate. There is no new migration.

## v1.112.0 — Call journals show time since the last file

«Телефонный трафик», «Операторы связи», «География звонков», «Сырые данные», and «Звонки на SMG» show how long it has been since the importer took a file. The counter sits in the title row, to the left of that row's buttons. Under an hour it reads `mm:ss`. From one hour it reads `h:mm:ss`. A file that contains call rows resets it, including a file whose calls were already in the database. A file with no call rows resets it too. A look that finds no new file does not.

On the softswitch pages the digits are green after a file that contained calls, yellow after a file with no calls, and red after a later scan that found neither a ready nor a young file. Green or yellow lasts until that empty scan. The scan runs on the registration interval, 60 seconds by default, and can land immediately after an import. «Звонки на SMG» uses the same counter with no color. The two sides do not share a clock. «Детализация» and «Статистика» do not show it. Hovering names the state and the time of that file. There is no new migration.

## v1.111.0 — One month delete covers CDR and SMG

Settings → «Хранение данных» lists one row per month for softswitch CDR and SMG. The columns are calls, seconds, and minutes for each. Seconds and minutes for SMG come from the integer `duration` field, with the same 3-second grace as CDR. The sizes of the CDR tables and `smg_cdr_records` are shown separately. The free-space warning for «Сжать базу» is still twice the sum of every table that `VACUUM FULL` copies.

One «Удалить» removes that month from both tables, then the jobs and audit rows whose timestamps fall in the same UTC month. Only the oldest month that still has CDR or SMG rows can be deleted, and never the current month. The live banner adds «Звонки SMG» with the same waiting, in-progress, and done states as the other stages.

An SMG file that contains the month being deleted stays in the inbox. Those rows are not inserted until the delete finishes. «Повторить импорт» during the delete does not clear that hold. A restart continues SMG, then jobs and audit, after the CDR rows of that month are already gone. Months whose CDR was deleted by an older release and whose SMG rows remain show up in the table and are deleted with the same button, oldest first. There is no new migration.

## v1.110.0 — SMG import shows files and errors in Jobs and Audit

«Задачи» and «Аудит» for `smg.import` now carry the same kind of detail as a softswitch CDR import. A clean run lists how many calls were inserted, how many files were read, how many lines were bad, and how many calls were already in the database. The expanded row names the file. A file left in the inbox with an error marks the job failed and puts that error in the result, including «Файл пустой» and «Частичная загрузка». The finish audit row stores status, file names, counts, and the error text. A run that only waited for a file still being written stays successful and has no error. There is no new migration.

## v1.109.0 — Softswitch CDR waits until FTP has finished the file

A softswitch dump can be marked «Файл пустой» while `STOR` has only just opened it. `ftp-srv` truncates the file before the bytes arrive, and the import of the previous file could record that zero size. If the clock did not move the modification time, later imports skipped the dump even after it was full. «Скачать» still returned the calls.

Import now ignores a file whose `STOR` is open, and reads it as soon as that `STOR` finishes. A file that shows up without `STOR` waits two seconds so a copy still being written is not deleted. If the file grows during the read, it stays in the inbox. A journal row that says the file is empty does not hold it once the file has bytes, so the next import loads `20261014_035348` without «Повторить импорт». A `STOR` that really closed with no bytes is still an error. SMG import is unchanged. There is no new migration.

## v1.108.0 — SMG calls are one gateway at a time

«Звонки на SMG» shows one gateway. The gateway menu is the «Узел» column (`device_sign`). There is no mixed table. The month menu sits at the right of the filter row, and the gateway menu sits immediately to its left. A gateway label is the node name and that node's call count for the month. The count ignores the phone search and the column filters. The number under the table includes them. Menu order is the database order of `device_sign`.

The first open, a month change, and a poll after an import recount the menu. Search, a column filter, the next page, and a gateway change do not. A month that no longer has the selected node switches to the first node of that month in the same response. Column filters stay when the month changes. Changing the gateway clears them and keeps the phone search. The «Узел» column stays in the table and is not a column filter.

The page query is equality on `device_sign` plus the disconnect-time range, ordered by `disconnect_time` and `id`, both descending. The new index is `(device_sign, disconnect_time DESC, id DESC)`. The index on `device_sign` alone is dropped in the same migration. The index on `disconnect_time, id` stays, so the gateway menu can walk one month. `CREATE INDEX` blocks writes on `smg_cdr_records` until it finishes and does not block reads. Do not deploy while a database compression of that table is running. The app pool waits 5 seconds for a lock. An `smg.import` that hits this build fails, leaves the file in the inbox, and does not mark it as a bad file. The next import inserts the rest of that file. Softswitch CDR writes are not blocked.

Migration: `20261014030000_smg_device_disconnect_idx`.

## v1.107.0 — SMG month list follows disconnect time

«Звонки на SMG» selects a month by the range of «Время разъединения вызова»: from `YYYY-MM-01 00:00:00` inclusive to the first instant of the next month exclusive. December rolls into January. For rows this importer writes, that is the same month as the civil date stored in `disconnect_day`. The list order uses a new index on `disconnect_time` and `id`, both descending. `CREATE INDEX` blocks writes on `smg_cdr_records` until it finishes and does not block reads. Do not deploy while a database compression of that table is running. The month switcher is not recounted while the next page of the table loads.

A CDR row shorter than its header by more than one field is a bad line. The file stays in the error list. One missing trailing field still loads: that is the empty last column collapsed into the terminator. Rows already inserted stay. There is no rewrite of stored calls.

The open page reads the latest finished `smg.import` before it reads the table. A call that lands after that read shows up on the next poll. The first import after an empty history does the same when it inserted rows or recorded bad lines. An empty import still leaves the rows in place.

Migration: `20261014020000_smg_disconnect_time_idx`.

## v1.106.0 — An empty SMG file may repeat its header

Eltex sometimes closes a CDR file that has no calls as a banner, the column header, a blank line, and the same header again. The second header was read as a call, so the file stayed in the error list with «нераспознано время разъединения». A line that matches the file header is now skipped. A real row with a bad disconnect time is still reported. After this image is deployed, use «Повторить импорт» once so the held file is cleared. There is no new migration.

## v1.105.0 — SMG calls refresh after an import that wrote rows

«Звонки на SMG» polls while the tab is visible, on the same 4 second rhythm as the softswitch traffic table. The list reloads when a later `smg.import` inserted rows or recorded bad lines. An empty import, including one started by a softswitch file on the shared FTP, advances the cursor and leaves the table in place. A hidden tab stops polling. A background failure does not clear the rows. There is no new migration.

## v1.104.0 — Passive FTP data ports for the SMG upload

Eltex SMG opens the file channel with `PASV` on the same listener the softswitch uses. Without an advertised address that command is rejected and the file never starts. Settings → FTP now has «Внешний IPv4 для пассивного режима». An empty value stores nothing and passive mode stays rejected, so the softswitch active upload is unchanged. A hostname is rejected. The reply uses that IPv4 and a port from 50100–50109.

Docker publishes `50100-50109:50100-50109`. Those host ports must be free before the stack update, and the host firewall must allow them the same way it allows 2121. Clearing the address turns passive mode off again without rolling back the image. There is no new migration.

## v1.103.0 — SMG CDR uses the softswitch FTP inbox

Eltex SMG-1016M uploads CDR through the same FTP listener as the softswitch, port 2121, with the same login. On the gateway the path is `/smg`. Files land in `cdr-inbox/smg`. The softswitch importer still reads only `YYYYMMDD_HHMMSS` names in the inbox root.

The separate SMG listener, host port 2122, and the Settings block «FTP — звонки SMG» are gone. The `smgFtp*` columns stay in `app_settings` so an image from v1.102.0 can still boot. There is no new migration. The unused volume `reg_smg_cdr_inbox` stays mounted.

## v1.102.0 — Ingest Eltex SMG-1016M CDR

«Звонки на SMG» lists calls from Eltex SMG-1016M. The gateways upload CDR by active FTP into a directory of their own (`reg_smg_cdr_inbox`, host port 2122). Settings has a separate block: enable, login, write-only password, port. The port cannot be the softswitch FTP port. PASV is not published.

Short firmware files have 50 columns. Full firmware files add «Время в очереди» and «Тип переадресации». A missing column is stored empty. The node is «Узел» (`Device Sign`). A clean file, including a header with no calls, is deleted. A bad line keeps the file, inserts the good rows, and shows the file name with «Скачать» and «Повторить импорт». A file that is still being written waits two seconds.

The month selector counts calls by the civil date of «Время разъединения вызова». Database compression includes `smg_cdr_records` after the softswitch CDR tables. Deleting an RTU month does not touch this table.

Migration: `20261013140000_smg_cdr`.

## v1.101.0 — Load a CDR row whose Call-ID contains a raw quote

A softswitch dump quotes every field and joins them with `";"`. A SIP Call-ID can contain a raw `"` that is not doubled. The quote-state split then loses the rest of the line and reports the wrong field count, so the file stays in the inbox.

Rows that already split into 120 fields keep that result. The header and the 10-column enrich parser are unchanged. Only a rejected data line is split again on `";"`. That second result is kept when it has exactly 120 fields. `""` inside a field is still one quote. A short or truncated line still fails. The stored Call-ID keeps the quote.

There is no new migration. Retry import on the held file inserts the rows that this recovers and then deletes the file.

## v1.100.0 — Download a failed CDR dump from raw data

«Сырые данные» lists each file the CDR import held back. Each row has «Скачать». The download is that inbox dump, with its original name and no extension. The route serves it only when the name is a softswitch dump (`YYYYMMDD_HHMMSS`) and that name is in the poison journal, including a file held while a month is deleted. A file still waiting for import is not served. The resolved path must stay inside the inbox, so a symlink that leaves the directory is refused. The bytes are the file on disk now; the journal mtime is not required to match. Database compression does not block this download: the file is not in the CDR tables.

There is no new migration.

## v1.99.0 — Compress the database after a month delete

«Сжать базу» on «Хранение данных» runs `VACUUM FULL` on `cdr_voipmonitor_links`, then `cdr_records`. It copies live rows and swaps each file at the end of that command. It does not delete rows. It does not rewrite `job_runs` or `audit_logs`. A month delete still removes that month's calls, job runs, and audit rows; this button only returns the disk those calls occupied.

The operator types `СЖАТЬ`. The job starts only when CDR import, month purge, VoIPmonitor match, side refresh, tariff rating, and month export are idle. While it runs, those jobs stay queued out, and traffic, stats, detail, and the jobs-list CDR probes answer immediately instead of waiting on the lock. The app pool uses a 5 second `lock_timeout` so a missed reader releases its connection. The vacuum session uses its own connection, with `statement_timeout` off and `lock_timeout` of 60 seconds. If that lock is not available, the job fails and the current table is unchanged.

The storage page lists the two tables. The active line shows the Postgres phase from `pg_stat_progress_cluster` when that view has a row. A failure, including `interrupted: process restarted`, stays on the page until the next start. A restart does not resume the rewrite. Inbox files are imported after the in-process flag drops, and again on process start. Free space on the Postgres volume must be at least twice the size of the two relations. The app cannot see that free space. One app replica remains required.

There is no new migration.

## v1.98.0 — Interrupted month purge finishes jobs and audit

A purge that was interrupted after its calls were already deleted resumes on the next process start. Startup reclaims the running row (`interrupted: process restarted`) and keeps its month and call count. If that month has no CDR rows left and still has job runs or audit rows in its UTC window, the app enqueues one history-only `cdr.purge.month`. It does not delete calls. It does not touch a month that has no interrupted purge of its own. A purge interrupted while calls remain stays on the storage table; the operator starts it again.

The resumed job writes the previous call count before the first history delete, so a second restart still finds the month. It checks that every foreign-key index from `20261010200000_purge_fk_indexes` exists and fails immediately when one is missing. The interrupted row stays eligible, so the next start tries again. The banner shows calls as already done, then moves through jobs and audit. Resume is armed after purge holds are cleared and before the CDR import drain, and the month is held so import cannot write those calls back while history is deleting. One app replica remains required.

There is no new migration. `CREATE INDEX` from v1.97.0 still has to finish before the app starts. Redeploying an older image over this purge drops the banner and leaves that month's jobs and audit in place.

## v1.97.0 — Month purge shows its stages

The storage banner lists the purge in order: calls, then job runs for that UTC month, then audit rows. The active stage shows done / total. A finished stage shows its result. A later stage shows that it is waiting and its total. A stage whose total is 0 is already done. The banner disappears when the job leaves the in-process queue. There is no «done» panel on the storage page.

Counts are taken once, before the first delete, with the same bounds the deletes use. The loop still stops when a batch returns 0. A mismatch between the count and the deletes is shown and does not fail the job. An older running row without `stages` still shows the single calls line.

A restart still drops the job (`interrupted: process restarted`). On v1.97.0 the next purge deletes the oldest month that still has calls and does not finish jobs and audit for a month whose calls are already gone. v1.98.0 resumes that history on the next start.

The migration only adds indexes: `job_runs.startedAt`, `cdr_records.lastJobRunId`, `reg_change_events.jobRunId`, and the smaller foreign keys that point at `job_runs`. It does not rewrite stored CDR rows. `CREATE INDEX` blocks writes on each table until it finishes. On `cdr_records` that lock is the long one. Deploy when CDR import can wait. Do not deploy while a purge is still running if that purge should finish its own job and audit stages: the process restart aborts it.

Autovacuum is still not part of the purge. Ordinary autovacuum marks freed pages for reuse. It does not shrink the file.

## v1.96.0 — Terminator capacity is «Канальность»

`Class4, 5 - Terminator Capacity Exceeded` is category «Ошибка» and type «Канальность». The check sits immediately after `Class4, 4 - Originator Capacity Exceeded` and beats redirect, check, phantom, outgoing, and incoming. Status is unchanged. The row uses the same red fill as every other «Ошибка».

«Детализация» adds «Канальность» before «МГ/МН». The cell is the month's count of those calls. Originator capacity counts for the client of the A-number. Terminator capacity counts for the client of the B-number. Zero is a dash. The total is the sum of the cells and is not yellow. A client with only these calls still appears. The other columns keep the call. The per-call XLSX sheet does not add this column. Its category and type are recomputed from the same rules.

A historical terminator-capacity call that was rated outgoing loses direction, price, and charge, so «МГ/МН» drops for the A-number client. Originator-capacity rows already store an empty tariff. The tariff backfill rewrites category, type, and those cells before the app starts. The v1.94.0 functions stay as shipped. `npx prisma migrate deploy` alone leaves stored rows unchanged.

## v1.95.0 — Канальность reads terminating capacity

«Канальность» on «Регистрации» copies `phone_endpoints.data["ТЕРМ. емкость"]` (the letter е), the same cell as «Телефонные номера». «ИНИЦ. емкость» is not a fallback. The RTU CSV header «ТЕРМ. Ёмкость» is not read. Empty, whitespace-only, and a missing catalog row stay empty («—», empty facet / XLSX cell). `"0"` stays `"0"`. Match by SIP number and first-row-by-name are unchanged. No migration. CDR type «Канальность» is unchanged.

## v1.94.0 — Outgoing direction on every status

«Исходящие» is «Исходящий». «Ошибки» is «Ошибка». The checkbox «Ошибки звонков», the type «Ошибка маршрута», and the group «Исходящий трафик» keep their names.

Every «Исходящий» call stores the catalog direction when the B-number is 11 digits starting with 7 and an ABC row matches. That includes «Местный», «Мобильный», «Междугородный», «Международный», and «Редирект», and it includes status «Неуспешный». A number outside that shape, or with no ABC row, still stores an empty direction. «Входящий», «Фантомный», «Проверка», and «Ошибка» stay unrated.

Price and charge are unchanged: only «Исходящий» with status «Успешный» or «Паркинг». «Местный» stores direction and leaves price and charge empty. «Междугородный», «Международный», «Мобильный», and «Редирект» store direction, price, and charge, including the three-second grace. A failed outgoing call stores direction and leaves price and charge empty, not `0.00`. «МГ/МН» does not change.

The category backfill no longer selects stored «Ошибка». That word is the live error category, and the old still-check would stop the migrator on the next restart. The tariff backfill rewrites the two labels and fills direction on failed outgoing rows. The v1.93.0 functions stay as shipped. `npx prisma migrate deploy` alone leaves stored rows unchanged.

## v1.93.0 — Mobile type and one «Ошибки» category

«Мобильный» is a call type. An 11-digit number starting with 79 is mobile, and 79 is no longer intercity. Outgoing and redirect look at the B-number. Incoming and phantom look at the A-number. The check sits after a local pair and before international, so a 79 number is not international.

Outgoing mobile is rated from the tariff catalog: the longest ABC on the B-number, that row's direction and price. Incoming and phantom mobile stay unrated. «Мобильный» is included in the «Успешные» checkbox. The three-second grace is unchanged: 0–3 ceiled seconds are 0 minutes and store `0.00` with direction and price.

«Ошибка маршрута», «Нет регистрации», and «Проверить» are one category, «Ошибки». Those first two phrases, plus the new type «Канальность», are types. Type «Ошибка» is gone. «Канальность» is the exact disconnect code `Class4, 4 - Originator Capacity Exceeded`. The three codes are checked first and beat redirect, check, phantom, outgoing, and incoming. «Проверить» is the leftover type and is checked last. Its category is still «Ошибки».

An outgoing call with a known side A is «Ошибки» / «Проверить» before geography when the B-number starts with 7 and is not exactly 11 digits, is all digits and shorter than 10 (including empty), or is all digits and longer than 15. Exactly 11 digits starting with 7 stay local, mobile, intercity, or international. 10–15 digits that do not start with 7 stay international. Incoming looks at A and is not affected. Redirect and check without an error code stay themselves even when B is short.

An empty duration is «Неуспешный», including on exact `Service_Parking`. «0» is non-empty. Every other call on exact `Service_Parking` is «Паркинг». `Service_Parking_1` and a name with a space are not parking.

«Ошибки» use the existing light-red fill and outrank parking blue and failed gray. Phantom stays green. There is no purple fill. The checkbox «Ошибки звонков» matches category «Ошибки». The parking checkbox is status «Паркинг», including phantom and errors on that device.

Rated redirects that carried an error code, and outgoing calls with the capacity code, lose direction, price, and charge because they become «Ошибки». «МГ/МН» is the sum of stored charges, so that sum drops for those rows. Mobile charges stay.

The new migration replaces geography, category, type, status, and the rater. The v1.91.0 and v1.92.0 migrations stay as shipped. The tariff backfill rewrites category, type, status, and charge before the app starts. `npx prisma migrate deploy` alone leaves stored rows unchanged.

## v1.92.0 — Three-second grace before a billed minute

Minutes stay derived from ceiled seconds and are still not stored. A call of 0, 1, 2, or 3 seconds is 0 minutes. From 4 seconds, minutes are still `CEIL(seconds / 60)`. 3000 ms is 3 seconds and 0 minutes. 3001 ms is 4 seconds and 1 minute. 61 seconds is still 2 minutes. A blank duration stays blank.

«Стоимость» of a rated call is those minutes times the per-minute price, ceiled to a kopeck. Zero minutes store `0.00` and keep direction and price. Who is rated does not change.

Every «Минуты» surface uses the grace: phone traffic, statistics, detail, the month table on settings, and both XLSX sheets. Call counts stay. Historical minute totals drop for calls of 1–3 seconds. Stored charges for rated calls of 1–3 seconds change from one minute to `0.00`, so «МГ/МН» drops for past months. Already downloaded workbooks stay as they were.

The new migration replaces `cdr_rate_call` only. The v1.91.0 migration stays as shipped. The tariff backfill rewrites changed charge cells before the app starts. `npx prisma migrate deploy` alone leaves stored charges unchanged. The tariff-rate job does not redo this pass while the tariff generation is already current.

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
