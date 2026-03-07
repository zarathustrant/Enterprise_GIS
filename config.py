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
    FRONTEND_URL = os.environ.get('FRONTEND_URL')
    REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    JOB_QUEUE_NAME = os.environ.get('JOB_QUEUE_NAME', 'enterprise_gis_jobs')
