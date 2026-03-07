import time
from flask import Flask, g, redirect, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from config import Config
from db import close_db
from auth import auth_bp
from layers import layers_bp
from features import features_bp
from ingestion import ingestion_bp
from analysis import analysis_bp
from schema_api import schema_bp
from enterprise_api import enterprise_bp


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)
    app.config.setdefault('REQUEST_METRICS', {
        'total_requests': 0,
        'total_errors': 0,
        'by_status': {},
        'avg_latency_ms': 0.0,
    })

    CORS(app)
    JWTManager(app)

    app.register_blueprint(auth_bp,       url_prefix='/api/v1/auth')
    app.register_blueprint(layers_bp,     url_prefix='/api/v1/layers')
    app.register_blueprint(features_bp,   url_prefix='/api/v1/layers')
    app.register_blueprint(ingestion_bp,  url_prefix='/api/v1/layers')
    app.register_blueprint(schema_bp,     url_prefix='/api/v1/layers')
    app.register_blueprint(analysis_bp,   url_prefix='/api/v1/analysis')
    app.register_blueprint(enterprise_bp, url_prefix='/api/v1')

    app.teardown_appcontext(close_db)

    @app.before_request
    def _record_start_time():
        g.request_start = time.perf_counter()

    @app.after_request
    def _record_metrics(response):
        started = getattr(g, 'request_start', None)
        latency_ms = (time.perf_counter() - started) * 1000 if started is not None else 0.0

        metrics = app.config['REQUEST_METRICS']
        metrics['total_requests'] += 1
        if response.status_code >= 500:
            metrics['total_errors'] += 1

        status_key = str(response.status_code)
        metrics['by_status'][status_key] = metrics['by_status'].get(status_key, 0) + 1

        total = metrics['total_requests']
        previous_avg = metrics['avg_latency_ms']
        metrics['avg_latency_ms'] = ((previous_avg * (total - 1)) + latency_ms) / max(total, 1)

        app.logger.info(
            'request method=%s path=%s status=%s latency_ms=%.2f',
            request.method,
            request.path,
            response.status_code,
            latency_ms,
        )
        return response

    @app.route('/')
    def index():
        frontend_url = app.config.get('FRONTEND_URL')
        if frontend_url:
            return redirect(frontend_url, code=302)
        return jsonify({
            'service': 'Enterprise GIS API',
            'health': '/health',
            'frontend_hint': 'Open http://localhost:5173 for the React application.',
        })

    @app.route('/health')
    def health():
        from db import get_db
        try:
            cur = get_db().cursor()
            cur.execute("SELECT PostGIS_Version()")
            version = cur.fetchone()['postgis_version']
            return jsonify({'status': 'healthy', 'postgis': version})
        except Exception as e:
            return jsonify({'status': 'unhealthy', 'error': str(e)}), 503

    @app.route('/health/metrics')
    def health_metrics():
        return jsonify(app.config['REQUEST_METRICS'])

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({'error': 'Not found'}), 404

    @app.errorhandler(405)
    def method_not_allowed(_):
        return jsonify({'error': 'Method not allowed'}), 405

    @app.errorhandler(500)
    def internal_error(e):
        return jsonify({'error': 'Internal server error', 'detail': str(e)}), 500

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
