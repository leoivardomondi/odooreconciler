#!/usr/bin/env python3
"""
Odoo Chatter Cleanup Script for Board Intake vs PO Mismatch
===========================================================
Finds and removes preexisting chatter messages of:
"Warning: Board Intake vs Purchase Order Communication Needed"
"""

import os
import sys
import argparse
import xmlrpc.client

def get_odoo_client():
    url = os.environ.get('ODOO_BASE_URL', '').strip().rstrip('/')
    db = os.environ.get('ODOO_DATABASE', '').strip()
    user = os.environ.get('ODOO_USERNAME', '').strip()
    api_key = os.environ.get('ODOO_API_KEY', '').strip()

    if not all([url, db, user, api_key]):
        env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('#') or '=' not in line:
                        continue
                    k, v = line.split('=', 1)
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k == 'ODOO_BASE_URL' and not url: url = v.rstrip('/')
                    elif k == 'ODOO_DATABASE' and not db: db = v
                    elif k == 'ODOO_USERNAME' and not user: user = v
                    elif k == 'ODOO_API_KEY' and not api_key: api_key = v

    if not all([url, db, user, api_key]):
        print("[ERROR] Missing Odoo credentials! Please set ODOO_BASE_URL, ODOO_DATABASE, ODOO_USERNAME, and ODOO_API_KEY.")
        sys.exit(1)

    print(f"[*] Connecting to Odoo at {url} (DB: {db}, User: {user})...")
    common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common")
    uid = common.authenticate(db, user, api_key, {})
    if not uid:
        print("[ERROR] Authentication failed! Check your Odoo username/api_key.")
        sys.exit(1)

    models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object")
    return db, uid, api_key, models

def main():
    parser = argparse.ArgumentParser(description="Find and remove manual board log vs PO mismatch chatter notes.")
    parser.add_argument('--delete', action='store_true', help="Delete the found mismatch chatter messages.")
    args = parser.parse_args()

    db, uid, api_key, models = get_odoo_client()

    patterns = [
        '%Warning: Board Intake vs Purchase Order Communication Needed%',
        '%Board Intake vs Purchase Order Communication Needed%',
    ]

    all_messages = []
    seen_ids = set()

    for pat in patterns:
        domain = [('body', 'ilike', pat)]
        msg_ids = models.execute_kw(
            db, uid, api_key,
            'mail.message', 'search',
            [domain],
            {'order': 'id desc'}
        )
        for mid in msg_ids:
            if mid not in seen_ids:
                seen_ids.add(mid)
                all_messages.append(mid)

    if not all_messages:
        print("[INFO] No mismatch chatter messages found matching patterns.")
        return

    print(f"[*] Found {len(all_messages)} matching mail.message records: {all_messages}")

    records = models.execute_kw(
        db, uid, api_key,
        'mail.message', 'read',
        [all_messages],
        {'fields': ['id', 'model', 'res_id', 'date', 'subject', 'body']}
    )

    for rec in records:
        print(f"\n- ID: {rec['id']} | Model: {rec.get('model')} | Res ID: {rec.get('res_id')} | Date: {rec.get('date')}")
        body_snippet = (rec.get('body') or '')[:120].replace('\n', ' ')
        print(f"  Snippet: {body_snippet}...")

    if args.delete:
        print(f"\n[ACTION] Deleting {len(all_messages)} mismatch chatter messages...")
        success = models.execute_kw(
            db, uid, api_key,
            'mail.message', 'unlink',
            [all_messages]
        )
        print(f"[SUCCESS] Unlink result: {success}. {len(all_messages)} messages removed from Odoo.")
    else:
        print("\n[NOTE] Dry run complete. Pass --delete to unlink these messages from Odoo chatter.")

if __name__ == '__main__':
    main()
