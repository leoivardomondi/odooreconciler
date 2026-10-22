#!/usr/bin/env python3
"""
Odoo Chatter Cleanup Script
============================
Finds and cleans or deletes raw/messy XML-RPC chatter log notes in Odoo (such as duplicate
`<p> 🪵 <strong>Board log completed...` messages).

Usage:
  python scripts/clean_odoo_chatter_logs.py --list
  python scripts/clean_odoo_chatter_logs.py --clean
  python scripts/clean_odoo_chatter_logs.py --delete-duplicates
  python scripts/clean_odoo_chatter_logs.py --delete-all-board-logs
"""

import os
import sys
import re
import argparse
import xmlrpc.client

def get_odoo_client():
    url = os.environ.get('ODOO_BASE_URL', '').strip().rstrip('/')
    db = os.environ.get('ODOO_DATABASE', '').strip()
    user = os.environ.get('ODOO_USERNAME', '').strip()
    api_key = os.environ.get('ODOO_API_KEY', '').strip()

    if not all([url, db, user, api_key]):
        # Try reading .env file if available
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

def clean_html_body(raw_body):
    """
    Cleans up raw escaped HTML tags, removes empty fields ('—'),
    and converts to a clean formatted note.
    """
    text = raw_body or ''
    # Replace <br> and </p><p> with newlines
    text = re.sub(r'</p>\s*<p>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    # Remove remaining HTML tags
    text = re.sub(r'</?[a-z0-9]+[^>]*>', '', text, flags=re.IGNORECASE)
    # Unescape HTML entities
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#039;', "'")
    
    # Remove empty placeholder lines like 'Gate: —' or 'Vehicle Reg: —'
    lines = []
    for line in text.split('\n'):
        cleaned_line = line.strip()
        if not cleaned_line:
            continue
        if re.search(r':\s*—\s*$', cleaned_line):
            continue  # Skip lines with empty em-dash
        lines.append(cleaned_line)

    return '\n'.join(lines)

def main():
    parser = argparse.ArgumentParser(description="Clean or delete messy board log chatter notes in Odoo.")
    parser.add_argument('--list', action='store_true', help="List all messy board log messages found in chatter.")
    parser.add_argument('--clean', action='store_true', help="Clean up raw HTML tags and format existing messages into clean text.")
    parser.add_argument('--delete-duplicates', action='store_true', help="Keep only 1 latest message per record and delete duplicates.")
    parser.add_argument('--delete-all', action='store_true', help="Delete all automated board log chatter messages.")
    parser.add_argument('--mo', type=str, help="Filter specifically by MO name or record ID (e.g. WH/MO/05477)")

    args = parser.parse_args()
    if not any([args.list, args.clean, args.delete_duplicates, args.delete_all]):
        args.list = True

    db, uid, api_key, models = get_odoo_client()

    domain = [
        '|',
        ('body', 'ilike', 'Board log completed'),
        ('body', 'ilike', 'BOARD INTAKE REVERTED')
    ]

    print("[*] Searching for board log messages in Odoo mail.message...")
    messages = models.execute_kw(
        db, uid, api_key, 'mail.message', 'search_read',
        [domain],
        {'fields': ['id', 'model', 'res_id', 'body', 'date', 'author_id', 'record_name'], 'order': 'id desc', 'limit': 100}
    )

    if not messages:
        print("[+] No board log messages found in chatter.")
        return

    print(f"[+] Found {len(messages)} board log chatter message(s).\n")

    seen_keys = set()
    to_delete = []
    to_clean = []

    for msg in messages:
        msg_id = msg['id']
        model = msg.get('model') or 'unknown'
        res_id = msg.get('res_id') or 0
        date = msg.get('date') or ''
        rec_name = msg.get('record_name') or f"{model},{res_id}"
        body = msg.get('body') or ''

        # Filter by MO if specified
        if args.mo and args.mo.lower() not in (rec_name.lower() + body.lower()):
            continue

        is_duplicate = False
        dedup_key = f"{model}:{res_id}:{re.sub(r'\\d{2}:\\d{2}:\\d{2}', '', body[:80])}"
        if dedup_key in seen_keys:
            is_duplicate = True
            to_delete.append(msg_id)
        else:
            seen_keys.add(dedup_key)

        print(f"Message ID #{msg_id} on [{rec_name}] ({date}):")
        cleaned_preview = clean_html_body(body)
        print("  " + "\n  ".join(cleaned_preview.split('\n')[:4]) + ("\n  ..." if len(cleaned_preview.split('\n')) > 4 else ""))
        if is_duplicate:
            print("  --> [DUPLICATE]")
        print("-" * 60)

    if args.delete_all:
        all_ids = [m['id'] for m in messages]
        print(f"\n[!] Deleting {len(all_ids)} board log messages...")
        models.execute_kw(db, uid, api_key, 'mail.message', 'unlink', [all_ids])
        print("[SUCCESS] All board log messages deleted from chatter!")
        return

    if args.delete_duplicates and to_delete:
        print(f"\n[!] Deleting {len(to_delete)} duplicate messages: {to_delete}...")
        models.execute_kw(db, uid, api_key, 'mail.message', 'unlink', [to_delete])
        print(f"[SUCCESS] Deleted {len(to_delete)} duplicate messages!")

    if args.clean:
        print(f"\n[*] Cleaning up raw HTML on {len(messages)} messages...")
        cleaned_count = 0
        for msg in messages:
            msg_id = msg['id']
            if msg_id in to_delete and args.delete_duplicates:
                continue
            cleaned = clean_html_body(msg.get('body') or '')
            # Update to clean HTML format
            formatted_html = "<p>" + cleaned.replace('\n', '<br/>') + "</p>"
            models.execute_kw(db, uid, api_key, 'mail.message', 'write', [[msg_id], {
                'body': formatted_html
            }])
            cleaned_count += 1
        print(f"[SUCCESS] Cleaned {cleaned_count} messages in Odoo chatter!")

if __name__ == '__main__':
    main()
