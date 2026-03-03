import os
from datetime import timedelta

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-change-in-production')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'jwt-dev-change-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)
    DATABASE_URL = os.environ.get(
        'DATABASE_URL',
        'postgresql://postgres:postgres@localhost:5432/enterprise_gis'
    )
