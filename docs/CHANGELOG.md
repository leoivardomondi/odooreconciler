# Change Log

All code and operational changes should be recorded here with the local date in
Africa/Nairobi time.

## 2026-06-30

- Switched local app configuration back to MySQL-only mode:
  - `DB_CLIENT=mysql`
  - `DB_HOST=127.0.0.1`
- Investigated the database startup/connection failure.
  - XAMPP is using the MySQL-compatible MariaDB server shipped at
    `C:\xampp\mysql\bin\mysqld.exe`.
  - The server log showed InnoDB corruption in MariaDB's internal system table
    `mysql/innodb_index_stats`.
  - The corrupted stats table files were backed up to
    `C:\xampp\mysql\data\mysql\codex_repair_backup_20260630_0231`.
  - Clean `innodb_index_stats.frm` and `innodb_index_stats.ibd` copies were
    restored from `C:\xampp\mysql\backup\mysql`.
  - After that repair, MariaDB stayed running on port `3306`.
- Remaining database blocker:
  - Resolved.
  - Direct MySQL client login was failing with
    `ERROR 1130 (HY000): Host 'localhost' is not allowed to connect to this MariaDB server`.
  - MariaDB's Aria privilege tables `mysql.db`, `mysql.global_priv`, and
    `mysql.proxies_priv` were also corrupt and were repaired offline with
    `aria_chk`.
  - The corrupted privilege table files were backed up to
    `C:\xampp\mysql\data\mysql\codex_priv_repair_backup_20260630_0241`.
  - A dedicated local app user was created:
    `reconciler_app@localhost` and `reconciler_app@127.0.0.1`.
  - `.env` was updated to use `DB_USER=reconciler_app` instead of `root`.
  - Verified `reconciler_app` can connect to `gponzghq_odooreconciler` and
    list project tables.
  - Ran `npm.cmd run build` successfully.
  - Restarted the local Node server and verified `http://localhost:3001/`
    returns `200 OK`.
