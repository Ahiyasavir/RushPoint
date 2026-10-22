"""Generate the founder's review document from the bank (mission-studio, lessons L18).

    python -I review_doc.py <bank.json> <state.json> <out.md>

bank.json  comes from scripts/dump_bank.ts (the CURRENT code, never a hand copy).
state.json says what he has seen and what changed:
    {
      "title": "...",
      "checked": ["key", ...],           # approved: passed without a note, or marked on the admin page
      "changed": {"key": "his note, in his words", ...},   # applied this round; shown with the NEW text
      "revised": {"key": "why I changed it", ...},        # my own rewrites, no note of his behind them
      "deleted": {"key-or-title": "why", ...}
    }
Every mission he has not checked is listed with its current text. Passing one without a note
approves it (SKILL.md step 8).
"""
import json
import sys

TYPE = {'photo': 'צילום', 'quiz': 'חידה', 'numeric': 'מספר', 'geofence': 'הגעה לנקודה',
        'smart_station': 'קוד', 'field': 'הגעה', 'survey': 'סקר', 'self_report': 'סימון',
        'sequence': 'שלבים'}
AUD = [('kids', 'ילדים'), ('youth', 'נוער'), ('adults', 'מבוגרים'), ('corporate', 'חברות'), ('mixed', 'מעורב')]


def line(e):
    aud = ', '.join(he for k, he in AUD if k in e['tags'])
    extra = []
    if e.get('timeLimitMinutes'):
        extra.append(f"{e['timeLimitMinutes']} דקות")
    if e.get('family'):
        extra.append(f"משפחה: {e['family']}")
    req = [s for s in e.get('setup', []) if s['required'] and s['field'] != 'coordinates']
    if req:
        extra.append('הכנה של היוצר')
    head = f"**{e['title']}** · {TYPE.get(e['type'], e['type'])} · {aud}"
    if extra:
        head += ' · ' + ' · '.join(extra)
    out = [head, f"> {e['desc']}"]
    for i, st in enumerate(e.get('steps') or [], 1):
        out.append(f"> שלב {i}: {st}")
    return out


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    bank = json.load(open(sys.argv[1], encoding='utf-8'))
    state = json.load(open(sys.argv[2], encoding='utf-8'))
    by_key = {e['key']: e for e in bank}
    checked = set(state.get('checked', []))
    changed = state.get('changed', {})
    deleted = state.get('deleted', {})
    revised = state.get('revised', {})  # my own changes, with the reason (not his notes)

    L = [f"# {state.get('title', 'משימות לבדיקה')}", '',
         'נוצר אוטומטית מהקוד של הבנק, אז כל טקסט כאן הוא הנוסח שרץ עכשיו.', '']
    if changed:
        L += [f'## שונו לפי ההערות שלך ({len(changed)})', '']
        for k, note in changed.items():
            if k in by_key:
                L += line(by_key[k]) + [f"*ההערה שלך: {note}*", '']
    if revised:
        L += [f'## שיפצתי בעצמי ({len(revised)})', '',
              'לא היו עליהן הערות שלך. זה הנוסח החדש, ולמה שיניתי.', '']
        for k, why in revised.items():
            if k in by_key:
                L += line(by_key[k]) + [f"*למה: {why}*", '']
    if deleted:
        L += [f'## נמחקו ({len(deleted)})', '']
        L += [f'- **{k}**: {why}' for k, why in deleted.items()] + ['']
    todo = [e for e in bank if e['key'] not in checked and e['key'] not in changed and e['key'] not in revised]
    L += [f'## עוד לא בדקת ({len(todo)} מתוך {len(bank)})', '',
          'אותה שיטה: מה שעובר בלי הערה נחשב מאושר.', '']
    groups = [
        ('לנוער', lambda e: 'youth' in e['tags'] and 'chores' not in e['tags'] and not e.get('occ')),
        ('יום הולדת ובר מצווה', lambda e: bool(e.get('occ'))),
        ('מטלות בית', lambda e: 'chores' in e['tags']),
        ('לילדים ולמשפחה בבית', lambda e: 'kids' in e['tags'] or 'home' in e['tags']),
        ('למבוגרים ולחברות', lambda e: True),
    ]
    seen = set()
    for title, pred in groups:
        items = [e for e in todo if pred(e) and e['key'] not in seen]
        if not items:
            continue
        L += [f'### {title} ({len(items)})', '']
        for e in items:
            seen.add(e['key'])
            L += line(e) + ['']
    open(sys.argv[3], 'w', encoding='utf-8', newline='\n').write('\n'.join(L))
    print(f'{len(todo)} unchecked, {len(changed)} changed, {len(deleted)} deleted -> {sys.argv[3]}')


if __name__ == '__main__':
    main()
