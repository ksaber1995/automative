"""
Activate all student QR codes for a single tenant (by owner email) on PROD.

A QR is "live" when qr_activated = true AND (qr_expiration IS NULL OR >= today).
So activating = set qr_activated = true and qr_expiration = NULL (lifelong) for
every student in the tenant's company.

Usage:
  python scripts/activate_qr_for_tenant.py            # dry-run (read-only)
  python scripts/activate_qr_for_tenant.py --apply    # perform the UPDATE
"""
import sys
import boto3

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'
EMAIL       = 'karimali201094@gmail.com'

session = boto3.Session(profile_name='personal', region_name='eu-west-1')
client = session.client('rds-data')


def q(sql, params=None):
    kwargs = dict(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=sql)
    if params:
        kwargs['parameters'] = params
    return client.execute_statement(**kwargs)


def scalar(resp):
    return resp['records'][0][0]


if __name__ == '__main__':
    apply = '--apply' in sys.argv

    # 1. Resolve the tenant's company_id from the owner email.
    r = q("SELECT u.company_id::text, c.name, c.type "
          "FROM users u JOIN companies c ON c.id = u.company_id "
          "WHERE LOWER(u.email) = LOWER(:e)",
          [{'name': 'e', 'value': {'stringValue': EMAIL}}])
    if not r['records']:
        print(f'No user/company found for {EMAIL}')
        sys.exit(1)
    rec = r['records'][0]
    company_id = rec[0]['stringValue']
    company_name = rec[1]['stringValue']
    company_type = rec[2]['stringValue']
    print(f'Tenant: {EMAIL}')
    print(f'Company: {company_name} ({company_type})  id={company_id}')

    cid_param = [{'name': 'cid', 'value': {'stringValue': company_id}, 'typeHint': 'UUID'}]

    # 2. Current state.
    r = q("SELECT COUNT(*), "
          "COUNT(*) FILTER (WHERE qr_activated), "
          "COUNT(*) FILTER (WHERE NOT qr_activated OR qr_activated IS NULL) "
          "FROM students WHERE company_id = :cid", cid_param)
    total = int(scalar(r)['longValue'])
    activated = int(r['records'][0][1]['longValue'])
    not_activated = int(r['records'][0][2]['longValue'])
    print(f'Students: {total} total | {activated} already activated | {not_activated} not activated')

    if not apply:
        print('\nDRY RUN — no changes made. Re-run with --apply to activate.')
        sys.exit(0)

    # 3. Activate: lifelong (qr_expiration NULL), free (qr_price 0, qr_paid true).
    r = q("UPDATE students "
          "SET qr_activated = true, qr_expiration = NULL, qr_price = 0, qr_paid = true, "
          "    updated_at = NOW() "
          "WHERE company_id = :cid RETURNING id", cid_param)
    updated = len(r['records'])
    print(f'\nOK — activated QR for {updated} students (lifelong, no charge).')
