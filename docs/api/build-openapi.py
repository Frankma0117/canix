"""Builds docs/api/openapi.yaml - the reference of Canix's HTTP API.

The endpoint list below is kept by hand next to the code it documents (backend/src/api/routes/);
run `python docs/api/build-openapi.py` after changing a route, and commit both files. No external
dependencies: the YAML is emitted directly.
"""
import json
import os

S = lambda name: {'$ref': f'#/components/schemas/{name}'}
STR = {'type': 'string'}
INT = {'type': 'integer'}
BOOL = {'type': 'boolean'}
NUM = {'type': 'number'}
DATE = {'type': 'string', 'format': 'date', 'example': '2026-10-21'}
WALL = {'type': 'string', 'description': "Local wall time 'YYYY-MM-DD HH:mm:ss' (America/Bogota)", 'example': '2026-10-21 18:30:00'}
NULLSTR = {'type': ['string', 'null']}
NULLINT = {'type': ['integer', 'null']}
ARR = lambda item: {'type': 'array', 'items': item}
OBJ = lambda props, required=None: {'type': 'object', 'properties': props, **({'required': required} if required else {})}

SCHEMAS = {
    'Error': OBJ({'error': {'type': 'string', 'description': 'Human-readable message (Spanish, shown in the portal).'}, 'code': STR}, ['error']),
    'Ok': OBJ({'ok': {'type': 'boolean', 'const': True}}),
    'Created': OBJ({'id': INT}, ['id']),
    'Session': OBJ({
        'id': INT, 'name': NULLSTR, 'phone': STR, 'phoneKnown': BOOL, 'role': {'enum': ['admin', 'user']},
        'permissions': ARR(STR), 'modules': ARR(STR), 'mustChangePassword': BOOL, 'hasPassword': BOOL,
        'testMode': {'type': ['object', 'null'], 'description': 'Administrator test mode, when on.'},
    }),
    'Category': OBJ({'id': INT, 'name': STR, 'description': NULLSTR, 'created_at': WALL,
                     'usage': OBJ({'links': INT, 'notes': INT, 'reminders': INT, 'todos': INT, 'recipes': INT})}),
    'Link': OBJ({'id': INT, 'category_id': NULLINT, 'url': STR, 'title': NULLSTR, 'description': NULLSTR, 'used_count': INT, 'last_used_at': NULLSTR, 'created_at': WALL}),
    'Contact': OBJ({'id': INT, 'name': STR, 'jid': STR, 'lid': NULLSTR, 'username': NULLSTR, 'notes': NULLSTR, 'created_at': WALL}),
    'Reminder': OBJ({
        'id': INT, 'message': STR, 'icon': STR, 'run_at': WALL, 'kind': {'enum': ['reminder', 'important_date', 'flexible', 'interval']},
        'status': {'enum': ['pending', 'executed', 'failed', 'cancelled', 'missed', 'suspended']},
        'recurrence_freq': {'enum': ['none', 'daily', 'weekly', 'monthly', 'yearly']}, 'recurrence_interval': INT,
        'category_id': NULLINT, 'target_jid': NULLSTR, 'paused_until': NULLSTR, 'window_start': NULLSTR, 'window_end': NULLSTR,
    }),
    'Todo': OBJ({
        'id': INT, 'title': STR, 'scope': {'enum': ['today', 'later', 'routine']}, 'status': {'enum': ['pending', 'done', 'skipped']},
        'category_id': NULLINT, 'due_date': NULLSTR, 'reminder_time': NULLSTR, 'duration_minutes': NULLINT, 'recurrence_freq': NULLSTR,
        'recurrence_interval': INT, 'weekdays': NULLSTR, 'month_day': NULLINT, 'start_date': NULLSTR, 'completed_at': NULLSTR, 'created_at': WALL,
    }),
    'Routine': {'allOf': [S('Todo'), OBJ({
        'schedule': STR, 'dueToday': BOOL, 'todayAnswer': {'enum': ['yes', 'no', None]}, 'streak': INT, 'nextNotice': NULLSTR, 'paused_until': NULLSTR,
    })], 'description': 'A routine with its schedule spelled out and today\'s state.'},
    'HabitLog': OBJ({'id': INT, 'todo_id': INT, 'log_date': DATE, 'done': INT, 'note': NULLSTR}),
    'PromptWithResponses': OBJ({
        'id': INT, 'title': STR, 'occurrence_date': DATE, 'sent_at': NULLSTR, 'answer': {'enum': ['yes', 'no', None]},
        'answered_at': NULLSTR, 'answer_source': NULLSTR,
        'responses': ARR(OBJ({'answer': {'enum': ['yes', 'no']}, 'source': {'enum': ['poll', 'reply', 'chat', 'web']}, 'created_at': WALL})),
    }),
    'RewardPunishment': OBJ({'id': INT, 'todo_id': NULLINT, 'type': {'enum': ['reward', 'punishment']}, 'description': STR, 'note': NULLSTR, 'date': DATE}),
    'CallReminder': OBJ({
        'id': INT, 'phone_number': STR, 'message': STR, 'call_type': {'enum': ['reminder', 'alarm']}, 'scheduled_at': WALL,
        'recurrence_freq': {'enum': ['none', 'daily', 'weekly', 'monthly', 'yearly']}, 'recurrence_interval': INT,
        'status': {'enum': ['pending', 'processing', 'completed', 'failed', 'cancelled']},
        'twilio_call_status': NULLSTR, 'attempts': INT, 'last_error': NULLSTR,
    }),
    'CallReminderInput': OBJ({
        'phone_number': {'type': 'string', 'description': 'E.164 or a local number (country code added).'}, 'message': STR,
        'call_type': {'enum': ['reminder', 'alarm']}, 'scheduled_at': WALL,
        'recurrence_freq': {'enum': ['none', 'daily', 'weekly', 'monthly', 'yearly']}, 'recurrence_interval': INT,
    }, ['phone_number', 'scheduled_at']),
    'Note': OBJ({'id': INT, 'title': NULLSTR, 'content': STR, 'category_id': NULLINT, 'created_at': WALL, 'updated_at': WALL}),
    'MealPlan': OBJ({'id': INT, 'plan_date': DATE, 'meal_slot': {'enum': ['desayuno', 'onces', 'almuerzo', 'media_tarde', 'cena']}, 'title': STR, 'notes': NULLSTR,
                     'meal_time': {'type': ['string', 'null'], 'description': "'HH:mm'. With a time the person gets \"hora del almuerzo\" on WhatsApp; null = only planned."},
                     'prep_minutes': {'type': ['integer', 'null'], 'description': 'Minutes before meal_time for the "toca preparar" notice.'}}),
    'MealInput': OBJ({'plan_date': DATE, 'meal_slot': {'enum': ['desayuno', 'onces', 'almuerzo', 'media_tarde', 'cena']}, 'title': STR, 'notes': NULLSTR,
                      'meal_time': {'type': ['string', 'null'], 'description': "'HH:mm'; empty/null removes the notices."},
                      'prep_minutes': {'type': ['integer', 'null'], 'description': '1-600; 0/null = no prep notice.'}}),
    'MedicationKind': {'enum': ['medicine', 'vitamin', 'supplement', 'cream', 'skincare', 'water', 'bodycare', 'other'], 'description': 'water = tomar agua: each dose taken is one glass. bodycare = girdle, compression socks... named by the action ("Ponerme la faja").'},
    'Medication': OBJ({
        'id': INT, 'name': STR, 'kind': S('MedicationKind'), 'dose': NULLSTR, 'instructions': NULLSTR,
        'times': {'type': 'array', 'items': {'type': 'string'}, 'description': "'HH:mm', sorted - a \"toca tomar\" notice at each."},
        'weekdays': {'type': ['array', 'null'], 'items': {'type': 'integer'}, 'description': '0 = Sunday; null = every day.'},
        'start_date': {'type': ['string', 'null'], 'format': 'date'}, 'end_date': {'type': ['string', 'null'], 'format': 'date', 'description': 'Last day of a treatment; null = ongoing.'},
        'notes': NULLSTR, 'active': {'type': 'boolean', 'description': 'false = paused: no notices until resumed.'},
        'week': OBJ({'taken': INT, 'missed': INT, 'pending': INT}),
        'today': OBJ({'done': INT, 'goal': INT}),
    }),
    'MedicationInput': OBJ({
        'name': STR, 'kind': S('MedicationKind'), 'dose': NULLSTR, 'instructions': NULLSTR,
        'times': {'type': 'array', 'items': {'type': 'string'}, 'description': "'HH:mm'. At least one on create."},
        'weekdays': {'type': ['array', 'null'], 'items': {'type': 'integer'}}, 'start_date': {'type': ['string', 'null'], 'format': 'date'},
        'end_date': {'type': ['string', 'null'], 'format': 'date'}, 'notes': NULLSTR, 'active': BOOL,
    }),
    'PackSticker': OBJ({
        'id': INT, 'label': NULLSTR, 'moments': ARR(STR), 'momentsSuggested': {'type': 'boolean', 'description': 'true = moments guessed from the name (none saved yet).'},
        'usage': NULLSTR, 'active': BOOL, 'sent_count': INT, 'last_sent_at': NULLSTR,
    }),
    'Recipe': OBJ({'id': INT, 'title': STR, 'ingredients': STR, 'instructions': STR, 'created_at': WALL}),
    'Checklist': OBJ({
        'id': INT, 'name': STR, 'kind': S('ListKind'),
        'items': ARR(OBJ({'id': INT, 'title': STR, 'checked': INT})),
    }),
    'ListKind': {'enum': ['musica', 'peliculas', 'series', 'libros', 'juegos', 'podcasts', 'compras', 'general'], 'description': 'What a list is a list of. Stored values; Spanish on purpose (data, not code).'},
    'MediaKind': {'enum': ['peliculas', 'series', 'musica', 'libros', 'juegos', 'podcasts']},
    'MediaItem': OBJ({
        'id': INT, 'checklist_id': INT, 'list_name': STR, 'kind': S('MediaKind'), 'title': STR,
        'checked': {'type': 'integer', 'description': '1 = watched / listened / read / played.'},
        'creator': NULLSTR, 'genre': NULLSTR, 'year': NULLINT, 'summary': NULLSTR, 'url': NULLSTR,
        'link_id': {'type': ['integer', 'null'], 'description': 'The same link in the general link library.'},
        'rating': {'type': ['integer', 'null'], 'minimum': 1, 'maximum': 5}, 'notes': NULLSTR, 'done_at': NULLSTR, 'created_at': WALL,
        'related_notes': ARR(OBJ({'id': INT, 'title': NULLSTR, 'content': STR})),
    }),
    'MediaInput': OBJ({
        'kind': S('MediaKind'), 'title': STR, 'creator': NULLSTR, 'genre': NULLSTR, 'year': NULLINT,
        'summary': NULLSTR, 'url': {'type': ['string', 'null'], 'description': 'http(s) URL. On create it is also saved in the link library, under the kind\'s category.'},
        'notes': NULLSTR, 'list': {'type': 'string', 'description': 'Name of the list to keep it in (created if missing). Default: the main list of that kind.'},
        'rating': {'type': ['integer', 'null'], 'minimum': 1, 'maximum': 5}, 'done': BOOL,
    }, ['kind', 'title']),
    'SaveMediaResult': OBJ({'itemId': INT, 'listName': STR, 'created': {'type': 'boolean', 'description': 'false = it already existed (same title, same kind) and was updated.'},
                            'link': OBJ({'id': INT, 'categoryName': STR, 'reused': BOOL})}),
    'CalendarEvent': OBJ({
        'key': STR, 'kind': {'enum': ['routine', 'reminder', 'todo', 'call', 'meal', 'medication', 'appointment']}, 'sourceId': INT, 'title': STR,
        'start': WALL, 'end': WALL, 'allDay': BOOL, 'done': {'type': ['boolean', 'null'], 'description': 'Routines/to-dos: done that day. Doses: taken / not taken.'}, 'detail': STR,
    }),
    'GarmentCard': OBJ({'id': INT, 'image_url': STR, 'thumbnail_url': NULLSTR, 'type': STR, 'category': STR, 'category_label': STR, 'color': NULLSTR, 'favorite': BOOL}),
    'Appointment': OBJ({
        'id': INT, 'professional_user_id': INT, 'client_user_id': INT, 'start_at': WALL, 'end_at': WALL,
        'status': {'enum': ['pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show', 'expired']},
        'reason': NULLSTR, 'notes': NULLSTR, 'professional_name': STR, 'client_name': NULLSTR,
    }),
    'AdminUser': OBJ({'id': INT, 'name': NULLSTR, 'jid': STR, 'phone': NULLSTR, 'role': STR, 'packages': ARR(INT), 'allow': ARR(STR), 'deny': ARR(STR)},),
    'PermissionPackage': OBJ({'id': INT, 'key': STR, 'name': STR, 'description': NULLSTR, 'is_system': INT, 'permissions': ARR(STR)}),
}

# (method, path, tag, summary, gate, {params}, body, response, notes)
P = lambda name, desc='', schema=INT, where='path', req=True: {'name': name, 'in': where, 'required': req if where == 'path' else False, 'description': desc, 'schema': schema}
Q = lambda name, desc='', schema=STR: P(name, desc, schema, 'query', False)
ID = P('id', 'Row id (only rows of the signed-in person are reachable).')

E = []
def ep(method, path, tag, summary, gate=None, params=(), body=None, resp=None, desc=None, status=None, public=False):
    E.append(dict(method=method, path=path, tag=tag, summary=summary, gate=gate, params=list(params), body=body, resp=resp, desc=desc, status=status, public=public))

# --- Auth ---
ep('post', '/api/auth/login', 'Auth', 'Sign in with WhatsApp number + password', public=True,
   body=OBJ({'phone': STR, 'password': STR}, ['phone', 'password']),
   resp=OBJ({'token': STR, 'user': S('Session'), 'mustChangePassword': BOOL}),
   desc='Rate limited per IP and per IP+number, on top of a per-account lockout. The token goes in `Authorization: Bearer <token>`.')
ep('get', '/api/auth/me', 'Auth', 'The signed-in person, their permissions and modules', resp=S('Session'))
ep('post', '/api/auth/logout', 'Auth', 'End this session', resp=S('Ok'))
ep('post', '/api/auth/change-password', 'Auth', 'Change (or, for the admin on the legacy token, set) the password',
   body=OBJ({'current': STR, 'next': {'type': 'string', 'minLength': 8}}, ['next']), resp=OBJ({'ok': BOOL, 'token': STR}))

# --- Calendar & library ---
ep('get', '/api/calendar', 'Calendar', 'Every dated item in a range, as calendar events',
   params=[Q('from', 'First day (inclusive).', DATE), Q('to', 'Last day (inclusive, at most 62 days after from).', DATE)],
   resp=ARR(S('CalendarEvent')), desc='Routines expanded day by day (with whether they were done), reminders and call reminders (recurring ones expanded), to-dos with a due date (all-day), the meal plan and appointments. Each kind only appears if the person has its permission.')
ep('get', '/api/library', 'Library', 'The media library (movies, series, music, books, games, podcasts)', 'library.manage',
   params=[Q('kind', '', S('MediaKind')), Q('status', 'pending | done (omitted = all)', {'enum': ['pending', 'done']}), Q('q', 'Search in title, summary, creator, genre and notes.')],
   resp=OBJ({'kinds': ARR(S('MediaKind')), 'lists': ARR(OBJ({'id': INT, 'name': STR, 'kind': S('MediaKind')})), 'items': ARR(S('MediaItem'))}))
ep('post', '/api/library', 'Library', 'Add an item (or update it when the same title already exists)', 'library.manage', body=S('MediaInput'), resp=S('SaveMediaResult'), status='201 when created, 200 when an existing item was updated.')
ep('patch', '/api/library/{id}', 'Library', 'Edit fields, mark done, rate or move to another list', 'library.manage', [ID],
   body=OBJ({'title': STR, 'creator': NULLSTR, 'genre': NULLSTR, 'year': NULLINT, 'summary': NULLSTR, 'url': NULLSTR, 'notes': NULLSTR, 'rating': {'type': ['integer', 'null']}, 'done': BOOL, 'list': STR}),
   resp=S('Ok'), desc='Only the fields sent change; null clears a field.')
ep('delete', '/api/library/{id}', 'Library', 'Delete an item', 'library.manage', [ID], resp=S('Ok'))

# --- Categories / links / contacts ---
ep('get', '/api/categories', 'Categories', 'Categories with what each one groups', 'any of links/reminders/notes/todos/recipes', resp=ARR(S('Category')))
ep('post', '/api/categories', 'Categories', 'Create a category', 'any of links/reminders/notes/todos/recipes', body=OBJ({'name': STR, 'description': STR}, ['name']), resp=S('Created'))
ep('put', '/api/categories/{id}', 'Categories', 'Rename / describe a category', 'any of links/reminders/notes/todos/recipes', [ID], body=OBJ({'name': STR, 'description': NULLSTR}), resp=S('Ok'))
ep('delete', '/api/categories/{id}', 'Categories', 'Delete a category (its items stay, uncategorized)', 'any of links/reminders/notes/todos/recipes', [ID], resp=S('Ok'))
ep('get', '/api/links', 'Links', 'Saved links', 'links.manage', [Q('categoryId', '', INT)], resp=ARR(S('Link')))
ep('post', '/api/links', 'Links', 'Save a link', 'links.manage', body=OBJ({'url': STR, 'category_id': NULLINT, 'title': STR, 'description': STR}, ['url']), resp=S('Created'))
ep('delete', '/api/links/{id}', 'Links', 'Delete a link', 'links.manage', [ID], resp=S('Ok'))
ep('get', '/api/contacts', 'Contacts', 'Saved contacts', 'contacts.manage', resp=ARR(S('Contact')))
ep('post', '/api/contacts', 'Contacts', 'Save a contact', 'contacts.manage', body=OBJ({'name': STR, 'phone': STR, 'notes': STR}, ['name', 'phone']), resp=S('Created'))
ep('delete', '/api/contacts/{id}', 'Contacts', 'Delete a contact', 'contacts.manage', [ID], resp=S('Ok'))

# --- Reminders ---
ep('get', '/api/reminders', 'Reminders', "The person's own reminders (routine notices and system rows excluded)", 'reminders.manage',
   [Q('status', '', {'enum': ['pending', 'executed', 'failed', 'cancelled', 'missed', 'suspended']}), Q('categoryId', '', INT)], resp=ARR(S('Reminder')))
ep('put', '/api/reminders/{id}', 'Reminders', 'Edit a reminder', 'reminders.manage', [ID],
   body=OBJ({'message': STR, 'run_at': WALL, 'category_id': NULLINT, 'recurrence_freq': {'enum': ['none', 'daily', 'weekly', 'monthly', 'yearly']}, 'recurrence_interval': INT}), resp=S('Ok'))
ep('post', '/api/reminders/{id}/cancel', 'Reminders', 'Cancel (kept in history)', 'reminders.manage', [ID], resp=S('Ok'))
ep('delete', '/api/reminders/{id}', 'Reminders', 'Delete', 'reminders.manage', [ID], resp=S('Ok'))
ep('get', '/api/call-reminders', 'Call reminders', 'Phone-call reminders and alarms', 'reminders.calls', [Q('status')], resp=ARR(S('CallReminder')))
ep('get', '/api/call-reminders/{id}', 'Call reminders', 'One call reminder', 'reminders.calls', [ID], resp=S('CallReminder'))
ep('post', '/api/call-reminders', 'Call reminders', 'Schedule a call', 'reminders.calls', body=S('CallReminderInput'), resp=S('CallReminder'))
ep('put', '/api/call-reminders/{id}', 'Call reminders', 'Edit a pending call', 'reminders.calls', [ID], body=S('CallReminderInput'), resp=S('CallReminder'))
ep('post', '/api/call-reminders/{id}/cancel', 'Call reminders', 'Cancel', 'reminders.calls', [ID], resp=S('Ok'))
ep('post', '/api/call-reminders/{id}/test', 'Call reminders', 'Place the call now (test)', 'reminders.calls', [ID], resp=S('Ok'), desc='A real, billed Twilio call.')
ep('delete', '/api/call-reminders/{id}', 'Call reminders', 'Delete', 'reminders.calls', [ID], resp=S('Ok'))

# --- Todos & routines ---
TODO_IN = OBJ({'title': STR, 'category_id': NULLINT, 'scope': {'enum': ['today', 'later', 'routine']}, 'due_date': NULLSTR,
               'reminder_time': {'type': 'string', 'description': "Routines: 'HH:mm'."}, 'duration_minutes': INT,
               'recurrence_freq': {'enum': ['daily', 'weekly', 'monthly']}, 'recurrence_interval': INT, 'weekdays': ARR(INT), 'month_day': INT, 'start_date': DATE})
ep('get', '/api/todos', 'To-dos', 'To-dos and routine rows', 'todos.manage (routine scope: routines.manage)', [Q('scope', '', {'enum': ['today', 'later', 'routine']}), Q('status'), Q('categoryId', '', INT)], resp=ARR(S('Todo')))
ep('post', '/api/todos', 'To-dos', 'Create a to-do or a routine (scope=routine also schedules its notices)', 'todos.manage / routines.manage', body=TODO_IN, resp=S('Created'))
ep('put', '/api/todos/{id}', 'To-dos', 'Edit', 'todos.manage / routines.manage', [ID], body=TODO_IN, resp=S('Ok'))
ep('post', '/api/todos/{id}/complete', 'To-dos', 'Mark done', 'todos.manage', [ID], resp=S('Ok'))
ep('delete', '/api/todos/{id}', 'To-dos', 'Delete (routines: also their notices and history)', 'todos.manage / routines.manage', [ID], resp=S('Ok'))
ep('get', '/api/routines', 'Routines', 'Routines ready to show (schedule, today, streak, next notice)', 'routines.manage', resp=ARR(S('Routine')))
ep('get', '/api/todos/{id}/history', 'Routines', 'Check-in history and streak', 'routines.manage', [ID, Q('days', 'Default 30.', INT)], resp=OBJ({'history': ARR(S('HabitLog')), 'streak': INT}))
ep('post', '/api/todos/{id}/checkin', 'Routines', 'Mark a day done / not done', 'routines.manage', [ID], body=OBJ({'date': DATE, 'done': BOOL, 'note': STR}), resp=S('Ok'))
ep('post', '/api/todos/{id}/reactivate', 'Routines', 'Resume a paused routine', 'routines.manage', [ID], resp=S('Ok'))
ep('get', '/api/todos/{id}/responses', 'Routines', '"¿Lo hiciste?" answers of one routine', 'routines.manage', [ID, Q('limit', '', INT)], resp=ARR(S('PromptWithResponses')))
ep('get', '/api/reminder-responses', 'Routines', 'Every "¿lo hiciste?" answer, newest first', 'reminders.manage or routines.manage', [Q('limit', '', INT)], resp=ARR(S('PromptWithResponses')))
ep('get', '/api/rewards', 'Rewards', 'Rewards and punishments', 'rewards.manage', [Q('type', '', {'enum': ['reward', 'punishment']}), Q('todoId', '', INT)], resp=ARR(S('RewardPunishment')))
ep('post', '/api/rewards', 'Rewards', 'Register one', 'rewards.manage', body=OBJ({'type': {'enum': ['reward', 'punishment']}, 'description': STR, 'todo_id': NULLINT, 'note': STR, 'date': DATE}, ['type', 'description']), resp=S('Created'))
ep('delete', '/api/rewards/{id}', 'Rewards', 'Delete', 'rewards.manage', [ID], resp=S('Ok'))

# --- Notes, meals, recipes, lists ---
ep('get', '/api/notes', 'Notes', 'Notes (search with q)', 'notes.manage', [Q('q')], resp=ARR(S('Note')))
ep('post', '/api/notes', 'Notes', 'Create a note', 'notes.manage', body=OBJ({'content': STR, 'title': NULLSTR, 'category_id': NULLINT}, ['content']), resp=S('Created'))
ep('put', '/api/notes/{id}', 'Notes', 'Edit a note', 'notes.manage', [ID], body=OBJ({'content': STR, 'title': NULLSTR, 'category_id': NULLINT}), resp=S('Ok'))
ep('delete', '/api/notes/{id}', 'Notes', 'Delete a note', 'notes.manage', [ID], resp=S('Ok'))
ep('get', '/api/meals', 'Meals', 'Meal plan in a range', 'meals.manage', [Q('from', '', DATE), Q('to', '', DATE)], resp=ARR(S('MealPlan')))
ep('post', '/api/meals', 'Meals', 'Plan a meal (with a time, its notices are scheduled)', 'meals.manage', body=S('MealInput'), resp=OBJ({'id': INT, 'notices': {'type': 'integer', 'description': 'Notices scheduled (0-2).'}}))
ep('put', '/api/meals/{id}', 'Meals', 'Edit a planned meal; its notices are rebuilt', 'meals.manage', [ID], body=S('MealInput'), resp=S('MealPlan'))
ep('delete', '/api/meals/{id}', 'Meals', 'Delete (with its notices)', 'meals.manage', [ID], resp=S('Ok'))
ep('get', '/api/medications', 'Medications', 'Everything in Medicamentos y belleza (paused ones too)', 'medications.manage',
   resp=OBJ({'kinds': {'type': 'object', 'description': 'kind -> {label, emoji, verb}'}, 'items': ARR(S('Medication'))}))
ep('post', '/api/medications', 'Medications', 'Add one; a notice is scheduled at each time', 'medications.manage', body=S('MedicationInput'), resp=S('Medication'), status='201')
ep('patch', '/api/medications/{id}', 'Medications', 'Edit, pause (active=false) or resume; notices are rebuilt', 'medications.manage', [ID], body=S('MedicationInput'), resp=S('Medication'))
ep('post', '/api/medications/{id}/log', 'Medications', 'Mark a dose taken / not taken (same as answering the notice)', 'medications.manage', [ID],
   body=OBJ({'taken': BOOL, 'date': DATE}), resp=S('Medication'))
ep('delete', '/api/medications/{id}', 'Medications', 'Delete, with its notices and dose history', 'medications.manage', [ID], resp=S('Ok'))
ep('get', '/api/recipes', 'Recipes', 'Saved recipes', 'recipes.manage', resp=ARR(S('Recipe')))
ep('post', '/api/recipes', 'Recipes', 'Save a recipe', 'recipes.manage', body=OBJ({'title': STR, 'ingredients': STR, 'instructions': STR}, ['title', 'ingredients', 'instructions']), resp=S('Created'))
ep('delete', '/api/recipes/{id}', 'Recipes', 'Delete', 'recipes.manage', [ID], resp=S('Ok'))
ep('get', '/api/lists', 'Lists', 'Lists with their items', 'todos.manage', resp=ARR(S('Checklist')))
ep('post', '/api/lists', 'Lists', 'Create a list', 'todos.manage', body=OBJ({'name': STR, 'kind': S('ListKind')}, ['name']), resp=S('Created'))
ep('put', '/api/lists/{id}', 'Lists', 'Rename / change kind', 'todos.manage', [ID], body=OBJ({'name': STR, 'kind': S('ListKind')}), resp=S('Ok'))
ep('delete', '/api/lists/{id}', 'Lists', 'Delete a list and its items', 'todos.manage', [ID], resp=S('Ok'))
ep('post', '/api/lists/{id}/items', 'Lists', 'Add an item', 'todos.manage', [ID], body=OBJ({'title': STR}, ['title']), resp=S('Created'))
ep('put', '/api/lists/items/{id}', 'Lists', 'Check / uncheck an item', 'todos.manage', [ID], body=OBJ({'checked': BOOL}, ['checked']), resp=S('Ok'))
ep('delete', '/api/lists/items/{id}', 'Lists', 'Delete an item', 'todos.manage', [ID], resp=S('Ok'))

# --- Wardrobe ---
ep('get', '/api/garments', 'Wardrobe', 'Garments, paged', 'fashion.use', [Q('type'), Q('limit', '1-200, default 60', INT), Q('offset', '', INT)], resp=OBJ({'rows': ARR(S('GarmentCard')), 'total': INT}))
ep('get', '/api/garments/taxonomy', 'Wardrobe', 'Types, categories and field options for editing', 'fashion.use', resp={'type': 'object'})
ep('get', '/api/garments/review', 'Wardrobe', 'Garments with open questions from the vision model', 'fashion.use', resp={'type': 'object'})
ep('get', '/api/garments/{id}', 'Wardrobe', 'One garment with every field', 'fashion.use', [ID], resp={'type': 'object'})
ep('put', '/api/garments/{id}', 'Wardrobe', 'Edit fields', 'fashion.use', [ID], body=OBJ({'fields': {'type': 'object', 'description': 'field -> value (taxonomy values only)'}}), resp=S('Ok'))
ep('put', '/api/garments/{id}/favorite', 'Wardrobe', 'Mark / unmark favorite', 'fashion.use', [ID], body=OBJ({'favorite': BOOL}), resp=S('Ok'))
ep('delete', '/api/garments/{id}', 'Wardrobe', 'Delete a garment (and its photos)', 'fashion.use', [ID], resp=S('Ok'))
ep('post', '/api/garments/reclassify', 'Wardrobe', 'Re-run the vision model on the whole wardrobe (background)', 'fashion.use', resp=OBJ({'queued': INT}))
ep('post', '/api/garment-questions/{id}/answer', 'Wardrobe', 'Answer a question about a garment', 'fashion.use', [ID], body=OBJ({'value': STR}, ['value']), resp=S('Ok'))
ep('post', '/api/garment-questions/{id}/skip', 'Wardrobe', 'Skip a question', 'fashion.use', [ID], resp=S('Ok'))

# --- Voices ---
ep('get', '/api/voices', 'Voice', 'Natural voices and the current one', 'voice.premium', resp=OBJ({'voices': ARR(OBJ({'key': STR, 'gender': STR, 'name': STR, 'style': STR})), 'current': NULLSTR, 'samplesAvailable': BOOL}))
ep('put', '/api/voices', 'Voice', 'Choose the voice', 'voice.premium', body=OBJ({'voice': STR}, ['voice']), resp=OBJ({'current': STR}))
ep('get', '/api/voices/{key}/sample', 'Voice', 'An MP3 sample of a voice', 'voice.premium', [P('key', 'Voice key.', STR)], resp={'type': 'string', 'format': 'binary', 'contentMediaType': 'audio/mpeg'})

# --- Scheduling ---
pro, cli = 'scheduling.professional', 'scheduling.client'
ep('get', '/api/scheduling/pro/profile', 'Scheduling', 'Professional profile, availability and time off', pro, resp={'type': 'object'})
ep('put', '/api/scheduling/pro/settings', 'Scheduling', 'Booking settings', pro, body=OBJ({'display_name': STR, 'specialty': NULLSTR, 'slot_minutes': INT, 'buffer_minutes': INT, 'min_notice_minutes': INT, 'max_days_ahead': INT, 'reminder_morning_time': NULLSTR, 'reminder_hours_before': NULLINT, 'auto_confirm': BOOL}), resp={'type': 'object'})
ep('put', '/api/scheduling/pro/availability', 'Scheduling', 'Replace the weekly availability', pro, body=OBJ({'rules': ARR(OBJ({'weekday': INT, 'start_time': STR, 'end_time': STR}))}, ['rules']), resp=S('Ok'))
ep('post', '/api/scheduling/pro/time-off', 'Scheduling', 'Block time', pro, body=OBJ({'start': WALL, 'end': WALL, 'reason': STR}, ['start', 'end']), resp=S('Created'))
ep('delete', '/api/scheduling/pro/time-off/{id}', 'Scheduling', 'Remove a block', pro, [ID], resp=S('Ok'))
ep('get', '/api/scheduling/pro/calendar', 'Scheduling', "The professional's appointments in a range", pro, [Q('from', '', DATE), Q('to', '', DATE)], resp=ARR(S('Appointment')))
ep('get', '/api/scheduling/pro/slots', 'Scheduling', 'Free slots', pro, [Q('from', '', DATE), Q('days', '', INT)], resp={'type': 'array'})
ep('post', '/api/scheduling/pro/appointments', 'Scheduling', 'Create an appointment for a client', pro, body=OBJ({'clientId': INT, 'start': WALL, 'duration_minutes': INT, 'reason': STR}, ['clientId', 'start']), resp=S('Created'))
ep('post', '/api/scheduling/pro/appointments/{id}/{action}', 'Scheduling', 'confirm / reject / cancel / complete / no-show', pro, [ID, P('action', '', {'enum': ['confirm', 'reject', 'cancel', 'complete', 'no-show']})], body=OBJ({'reason': STR}), resp=S('Ok'))
ep('put', '/api/scheduling/pro/appointments/{id}/notes', 'Scheduling', 'Private notes on an appointment', pro, [ID], body=OBJ({'notes': NULLSTR}), resp=S('Ok'))
ep('get', '/api/scheduling/pro/clients', 'Scheduling', 'Clients who can book', pro, resp={'type': 'array'})
ep('post', '/api/scheduling/pro/clients', 'Scheduling', 'Share the booking with a client (bot writes to them)', pro, body=OBJ({'name': STR, 'phone': STR}, ['phone']), resp={'type': 'object'})
ep('delete', '/api/scheduling/pro/clients/{clientId}', 'Scheduling', 'Stop sharing with a client', pro, [P('clientId')], resp=S('Ok'))
ep('get', '/api/scheduling/client/professionals', 'Scheduling', 'Professionals this client can book with', cli, resp={'type': 'array'})
ep('get', '/api/scheduling/client/slots', 'Scheduling', 'Free slots of a professional', cli, [Q('professionalId', '', INT), Q('from', '', DATE), Q('days', '', INT)], resp={'type': 'array'})
ep('get', '/api/scheduling/client/appointments', 'Scheduling', "The client's appointments", cli, resp=ARR(S('Appointment')))
ep('post', '/api/scheduling/client/appointments', 'Scheduling', 'Request an appointment', cli, body=OBJ({'professionalId': INT, 'start': WALL, 'reason': STR}, ['professionalId', 'start']), resp=S('Created'))
ep('post', '/api/scheduling/client/appointments/{id}/cancel', 'Scheduling', 'Cancel own appointment', cli, [ID], body=OBJ({'reason': STR}), resp=S('Ok'))
ep('get', '/api/scheduling/appointments/{id}', 'Scheduling', 'Appointment detail with history and files (either side)', f'{pro} or {cli}', [ID], resp={'type': 'object'})
ep('post', '/api/scheduling/appointments/{id}/files', 'Scheduling', 'Attach files (multipart, field "files")', f'{pro} or {cli}', [ID], body={'type': 'object', 'description': 'multipart/form-data'}, resp={'type': 'array'})
ep('get', '/api/files/{id}', 'Scheduling', 'Download an attached file', 'owner or the other party of its appointment', [ID], resp={'type': 'string', 'format': 'binary'})
ep('delete', '/api/files/{id}', 'Scheduling', 'Delete an attached file', 'its uploader', [ID], resp=S('Ok'))

# --- Admin ---
ADMIN = 'administrator'
ep('get', '/api/admin/users', 'Admin', 'Everyone with access', ADMIN, resp=ARR(S('AdminUser')))
ep('post', '/api/admin/users', 'Admin', 'Grant access to a number', ADMIN, body=OBJ({'phone': STR, 'name': STR, 'packageIds': ARR(INT), 'allow': ARR(STR), 'deny': ARR(STR), 'notify': BOOL}, ['phone']), resp=S('AdminUser'))
ep('put', '/api/admin/users/{id}', 'Admin', 'Edit name / real number', ADMIN, [ID], body=OBJ({'name': STR, 'phone': STR}), resp=S('AdminUser'))
ep('put', '/api/admin/users/{id}/access', 'Admin', 'Set packages and allow/deny overrides', ADMIN, [ID], body=OBJ({'packageIds': ARR(INT), 'allow': ARR(STR), 'deny': ARR(STR)}), resp=S('AdminUser'))
ep('put', '/api/admin/users/{id}/permissions/{key}', 'Admin', 'One permission override (allow / deny / null = inherit)', ADMIN, [ID, P('key', 'Permission key', STR)], body=OBJ({'effect': {'enum': ['allow', 'deny', None]}}), resp=S('AdminUser'))
ep('post', '/api/admin/users/{id}/temp-password', 'Admin', 'Issue a temporary password (optionally sent by WhatsApp)', ADMIN, [ID], body=OBJ({'sendWhatsApp': BOOL}), resp=OBJ({'password': STR, 'sent': BOOL}))
ep('post', '/api/admin/users/{id}/resolve-phone', 'Admin', 'Learn the real number of someone known only by @lid', ADMIN, [ID], resp=S('AdminUser'))
ep('post', '/api/admin/users/{id}/unlock', 'Admin', 'Clear a login lockout', ADMIN, [ID], resp=S('Ok'))
ep('post', '/api/admin/users/{id}/logout-all', 'Admin', 'Close every session of a person', ADMIN, [ID], resp=S('Ok'))
ep('delete', '/api/admin/users/{id}', 'Admin', 'Revoke access and delete their data', ADMIN, [ID, Q('confirm', 'Must be "true".')], resp=S('Ok'))
ep('post', '/api/admin/users/{id}/demo', 'Admin', 'Extend or convert a demo account', ADMIN, [ID], body=OBJ({'action': {'enum': ['extend', 'convert']}, 'hours': INT}, ['action']), resp=S('AdminUser'))
ep('get', '/api/admin/permissions', 'Admin', 'The permission catalog', ADMIN, resp={'type': 'array'})
ep('get', '/api/admin/packages', 'Admin', 'Permission packages', ADMIN, resp=ARR(S('PermissionPackage')))
ep('post', '/api/admin/packages', 'Admin', 'Create a package (paid permissions are rejected)', ADMIN, body=OBJ({'name': STR, 'description': STR, 'permissions': ARR(STR)}, ['name']), resp=S('PermissionPackage'))
ep('put', '/api/admin/packages/{id}', 'Admin', 'Edit a package', ADMIN, [ID], body=OBJ({'name': STR, 'description': STR, 'permissions': ARR(STR)}), resp=S('PermissionPackage'))
ep('delete', '/api/admin/packages/{id}', 'Admin', 'Delete a package', ADMIN, [ID], resp=S('Ok'))
ep('get', '/api/admin/audit', 'Admin', 'Access-change audit trail', ADMIN, [Q('userId', '', INT), Q('limit', '', INT)], resp={'type': 'array'})
ep('get', '/api/admin/usage', 'Admin', 'Usage of paid operations per person', ADMIN, [Q('days', '', INT)], resp={'type': 'array'})
ep('get', '/api/admin/analytics', 'Admin', 'First-party web analytics', ADMIN, [Q('days', '', INT)], resp={'type': 'object'})
ep('get', '/api/admin/test-mode', 'Admin', 'Current test mode', ADMIN, resp={'type': ['object', 'null']})
ep('post', '/api/admin/test-mode', 'Admin', 'Try WhatsApp as a person with only these permissions', ADMIN, body=OBJ({'label': STR, 'packageId': INT, 'permissions': ARR(STR)}), resp={'type': 'object'})
ep('delete', '/api/admin/test-mode', 'Admin', 'Leave test mode', ADMIN, resp=S('Ok'))
ep('get', '/api/admin/scheduling/professionals', 'Admin', 'Every professional', ADMIN, resp={'type': 'array'})
ep('get', '/api/admin/scheduling/groups', 'Admin', 'Scheduling groups', ADMIN, resp={'type': 'array'})
ep('post', '/api/admin/scheduling/groups', 'Admin', 'Create a group', ADMIN, body=OBJ({'name': STR, 'description': STR}, ['name']), resp=S('Created'))
ep('put', '/api/admin/scheduling/groups/{id}', 'Admin', 'Edit a group and its members', ADMIN, [ID], body=OBJ({'name': STR, 'description': STR, 'members': ARR(INT)}), resp=S('Ok'))
ep('delete', '/api/admin/scheduling/groups/{id}', 'Admin', 'Delete a group', ADMIN, [ID], resp=S('Ok'))
ep('post', '/api/admin/scheduling/groups/{id}/clients', 'Admin', 'Share a whole group with a client', ADMIN, [ID], body=OBJ({'name': STR, 'phone': STR}, ['phone']), resp={'type': 'object'})
ep('delete', '/api/admin/scheduling/groups/{id}/clients/{clientId}', 'Admin', 'Stop sharing a group', ADMIN, [ID, P('clientId')], resp=S('Ok'))
ep('get', '/api/admin/stickers', 'Admin', "The admin's sticker pack, the moments catalog and how many stickers cover each moment", ADMIN,
   resp=OBJ({'moments': ARR(OBJ({'key': STR, 'label': STR, 'when': STR})), 'stickers': ARR(S('PackSticker')), 'coverage': {'type': 'object', 'description': 'moment key -> active stickers for it'}}))
ep('get', '/api/admin/stickers/{id}/image', 'Admin', 'The sticker image (webp)', ADMIN, [ID], resp={'type': 'string', 'format': 'binary'})
ep('post', '/api/admin/stickers', 'Admin', 'Upload stickers (multipart `files`, up to 30, 1 MB each)', ADMIN, body={'type': 'object', 'description': 'multipart/form-data'}, resp={'type': 'object'})
ep('patch', '/api/admin/stickers/{id}', 'Admin', 'Name, moments (null = suggest from the name), free-text usage, active', ADMIN, [ID],
   body=OBJ({'label': STR, 'moments': {'type': ['array', 'null'], 'items': {'type': 'string'}}, 'usage': NULLSTR, 'active': BOOL}), resp=S('Ok'))
ep('delete', '/api/admin/stickers/{id}', 'Admin', 'Delete a sticker from the pack', ADMIN, [ID], resp=S('Ok'))
ep('get', '/api/admin/scheduling/calendar', 'Admin', 'Combined calendar of a group or professional', ADMIN, [Q('groupId', '', INT), Q('professionalId', '', INT), Q('from', '', DATE), Q('to', '', DATE)], resp=ARR(S('Appointment')))
ep('get', '/api/connection/status', 'WhatsApp connection', 'Connection state, QR availability, send-guard stats', ADMIN, resp={'type': 'object'})
ep('get', '/api/connection/qr/png', 'WhatsApp connection', 'The pairing QR as PNG', ADMIN, resp={'type': 'string', 'format': 'binary', 'contentMediaType': 'image/png'})
ep('post', '/api/connection/reconnect', 'WhatsApp connection', 'Reconnect the session', ADMIN, resp=S('Ok'))
ep('post', '/api/connection/new-number', 'WhatsApp connection', 'Unlink and start over with a new number (new QR)', ADMIN, resp=S('Ok'))

# --- Public ---
ep('get', '/api/public/config', 'Public', 'Public site config (contact number, demo availability)', public=True, resp={'type': 'object'})
ep('post', '/api/public/demo', 'Public', 'Request a free demo (returns a code to send by WhatsApp)', public=True, body=OBJ({'name': STR, 'interest': STR, 'website': {'type': 'string', 'description': 'Honeypot: must be empty.'}}, ['name']), resp=OBJ({'code': STR, 'whatsappUrl': STR}))
ep('post', '/api/public/track', 'Public', 'First-party analytics event (no IPs stored)', public=True, body={'type': 'object'}, status='204')
ep('post', '/webhooks/twilio/call-status', 'Webhooks', "Twilio's call status callback", public=True,
   body={'type': 'object', 'description': 'application/x-www-form-urlencoded, Twilio-signed (X-Twilio-Signature is verified).', 'properties': {'CallSid': STR, 'CallStatus': STR}}, status='204',
   desc='Not for clients: only Twilio calls it, and requests without a valid signature are rejected.')

TAG_DOC = {
    'Auth': 'Portal sign-in. Every other /api route needs `Authorization: Bearer <token>`.',
    'Calendar': 'The agenda as calendar events.',
    'Library': 'Movies, series, music, books, games and podcasts - the special lists, with their media fields.',
    'Categories': 'Categories shared by links, notes, reminders, to-dos and recipes.',
    'Links': 'The link library.',
    'Contacts': "People the bot can write to on the person's behalf.",
    'Reminders': 'WhatsApp reminders created by the person (routine notices live under Routines).',
    'Call reminders': 'Reminders and alarms delivered as real phone calls (Twilio). Paid extra.',
    'To-dos': 'One-off tasks for today or later. Routines share the table (scope=routine).',
    'Routines': 'Recurring habits: schedule, check-ins, streaks and "¿lo hiciste?" answers.',
    'Rewards': 'Rewards and punishments, optionally tied to a routine.',
    'Notes': 'Free-text notes ("tips clave").',
    'Meals': 'Meal plan by date and slot; with a time it sends "hora del almuerzo" and, optionally, "toca preparar".',
    'Medications': 'Medicamentos y belleza: medicines, vitamins, creams, skincare, water and body care with their notice times and dose history.',
    'Recipes': 'Saved recipes.',
    'Lists': 'Lists ticked off item by item. Media-kind lists are also the Library.',
    'Wardrobe': 'Fashion Mode wardrobe. Adding garments (photos) happens on WhatsApp.',
    'Voice': 'Natural voice for voice notes and calls (paid extra).',
    'Scheduling': 'Appointment booking: the professional side (pro) and the client side (client).',
    'Admin': 'Administration: people, permissions, packages, usage, analytics, test mode.',
    'WhatsApp connection': 'The single WhatsApp session the bot runs on.',
    'Public': 'Unauthenticated endpoints used by the public sales site.',
    'Webhooks': 'Called by third parties.',
}


def to_path(p):
    return p.replace('{', '{').replace(':', '')


def operation(e):
    op = {'tags': [e['tag']], 'summary': e['summary'], 'operationId': f"{e['method']}{''.join(w.capitalize() for w in e['path'].replace('{', '').replace('}', '').replace('-', '/').split('/') if w)}"}
    desc = []
    if e['desc']:
        desc.append(e['desc'])
    if e['gate']:
        desc.append(f"**Permission:** `{e['gate']}`" if e['gate'] != 'administrator' else '**Administrator only.**')
    if desc:
        op['description'] = '\n\n'.join(desc)
    if e['public']:
        op['security'] = []
    if e['params']:
        op['parameters'] = e['params']
    if e['body'] is not None:
        op['requestBody'] = {'required': True, 'content': {'application/json': {'schema': e['body']}}}
    ok = '204' if e['status'] == '204' else '200'
    responses = {}
    if ok == '204':
        responses['204'] = {'description': 'No content'}
    else:
        responses[ok] = {'description': e['status'] or 'OK', 'content': {'application/json': {'schema': e['resp'] or S('Ok')}}}
    responses['400'] = {'description': 'Invalid input', 'content': {'application/json': {'schema': S('Error')}}}
    if not e['public']:
        responses['401'] = {'description': 'Missing or expired session', 'content': {'application/json': {'schema': S('Error')}}}
        responses['403'] = {'description': 'Module not enabled for this person', 'content': {'application/json': {'schema': S('Error')}}}
    if any(p['in'] == 'path' for p in e['params']):
        responses['404'] = {'description': 'Not found (or not yours)', 'content': {'application/json': {'schema': S('Error')}}}
    op['responses'] = responses
    return op


spec = {
    'openapi': '3.1.0',
    'info': {
        'title': 'Canix API',
        'version': '0.2.0',
        'description': (
            'HTTP API behind the Canix portal (frontend/) and public site. JSON in and out; dates and '
            "times are local wall-clock strings in the bot's time zone (America/Bogota). Every row is "
            'scoped to the signed-in person: ids of other people\'s rows answer 404. Error messages are '
            'Spanish because the portal shows them as they come.\n\n'
            'Limits: 240 requests/minute per IP on /api, 30 s per request, 200 KB JSON bodies.'
        ),
    },
    'servers': [{'url': 'https://canix.cania.app', 'description': 'Production'}, {'url': 'http://localhost:3000', 'description': 'Local'}],
    'security': [{'bearerAuth': []}],
    'tags': [{'name': t, **({'description': TAG_DOC[t]} if t in TAG_DOC else {})} for t in dict.fromkeys(e['tag'] for e in E)],
    'paths': {},
    'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer', 'description': 'Session token from POST /api/auth/login.'}}, 'schemas': SCHEMAS},
}
for e in E:
    spec['paths'].setdefault(e['path'], {})[e['method']] = operation(e)


def yaml(value, indent=0):
    pad = '  ' * indent
    if isinstance(value, dict):
        if not value:
            return ' {}'
        out = ''
        for k, v in value.items():
            key = json.dumps(k) if (not isinstance(k, str) or not k.replace('_', '').replace('-', '').replace('$', '').isalnum()) else k
            if isinstance(v, (dict, list)) and v:
                out += f'\n{pad}{key}:{yaml(v, indent + 1)}'
            else:
                out += f'\n{pad}{key}: {scalar(v)}'
        return out
    if isinstance(value, list):
        if not value:
            return ' []'
        out = ''
        for v in value:
            if isinstance(v, dict) and v:
                inner = yaml(v, indent + 1).lstrip('\n')
                out += f'\n{pad}- {inner.lstrip()}'
            else:
                out += f'\n{pad}- {scalar(v)}'
        return out
    return ' ' + scalar(value)


def scalar(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        return '{}' if isinstance(v, dict) else '[]'
    return json.dumps(v, ensure_ascii=False)


here = os.path.dirname(os.path.abspath(__file__))
header = '# Generated by docs/api/build-openapi.py - edit that file, then run it again.\n'
open(os.path.join(here, 'openapi.yaml'), 'w', encoding='utf8', newline='\n').write(header + yaml(spec).lstrip('\n') + '\n')
print(f"{len(E)} operations, {len(spec['paths'])} paths")
