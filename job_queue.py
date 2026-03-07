import os

try:
    import redis
except Exception:  # pragma: no cover
    redis = None


def get_redis_client(redis_url: str):
    if redis is None:
        return None
    try:
        return redis.Redis.from_url(redis_url)
    except Exception:
        return None


def enqueue_job(redis_url: str, queue_name: str, job_id: str) -> bool:
    client = get_redis_client(redis_url)
    if client is None:
        return False
    try:
        client.rpush(queue_name, job_id)
        return True
    except Exception:
        return False


def blocking_pop_job(redis_url: str, queue_name: str, timeout_seconds: int = 5) -> str | None:
    client = get_redis_client(redis_url)
    if client is None:
        return None

    try:
        result = client.blpop(queue_name, timeout=timeout_seconds)
        if not result:
            return None
        _, raw_value = result
        return raw_value.decode('utf-8')
    except Exception:
        return None


def queue_enabled(redis_url: str) -> bool:
    client = get_redis_client(redis_url)
    if client is None:
        return False
    try:
        client.ping()
        return True
    except Exception:
        return False


if __name__ == '__main__':
    redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    queue_name = os.environ.get('JOB_QUEUE_NAME', 'enterprise_gis_jobs')
    print('queue_enabled', queue_enabled(redis_url), 'queue_name', queue_name)
