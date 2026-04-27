import boto3
import time
import sys

session = boto3.Session(profile_name='personal')
client = session.client('rds-data', region_name='eu-west-1')

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-dev-automatemagicauroradbef2379-yqb2wihdkbe8'
SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/dev/automate-magic/db-credentials-i8zzeQ'
DATABASE = 'automative'

statements = [
    # ROOMS TABLE
    """CREATE TABLE IF NOT EXISTS rooms (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        code VARCHAR(50) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch_id, code)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_rooms_company_id ON rooms(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_rooms_branch_id ON rooms(branch_id)",
    "CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms(is_active)",
    "DROP TRIGGER IF EXISTS update_rooms_updated_at ON rooms",
    "CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",

    # ADD default_room_id TO COURSES
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS default_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS idx_courses_default_room_id ON courses(default_room_id)",

    # SESSIONS TABLE
    """CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        end_date TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_sessions_company_id ON sessions(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_branch_id ON sessions(branch_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_class_id ON sessions(class_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_start_date ON sessions(start_date)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_end_date ON sessions(end_date)",
    "DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions",
    "CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
]

errors = []

def run(sql, desc=None):
    label = desc or sql.strip()[:80]
    try:
        client.execute_statement(
            resourceArn=CLUSTER_ARN,
            secretArn=SECRET_ARN,
            database=DATABASE,
            sql=sql.strip()
        )
        print('  OK: ' + label)
    except Exception as e:
        print('  ERR: ' + label)
        print('    ERROR: ' + str(e))
        errors.append((label, str(e)))

print('Running Migration 023: Rooms and Sessions...')
print('=' * 60)

run(statements[0], 'Create rooms table')
run(statements[1], 'Index rooms.company_id')
run(statements[2], 'Index rooms.branch_id')
run(statements[3], 'Index rooms.is_active')
run(statements[4], 'Drop old rooms trigger')
run(statements[5], 'Create rooms updated_at trigger')
time.sleep(0.2)

run(statements[6], 'Add default_room_id to courses')
run(statements[7], 'Index courses.default_room_id')
time.sleep(0.2)

run(statements[8], 'Create sessions table')
run(statements[9], 'Index sessions.company_id')
run(statements[10], 'Index sessions.branch_id')
run(statements[11], 'Index sessions.room_id')
run(statements[12], 'Index sessions.class_id')
run(statements[13], 'Index sessions.start_date')
run(statements[14], 'Index sessions.end_date')
run(statements[15], 'Drop old sessions trigger')
run(statements[16], 'Create sessions updated_at trigger')

print('=' * 60)
if errors:
    print('\nCompleted with ' + str(len(errors)) + ' error(s):')
    for label, err in errors:
        print('  - ' + label + ': ' + err)
    sys.exit(1)
else:
    print('\nMigration 023 completed successfully!')
