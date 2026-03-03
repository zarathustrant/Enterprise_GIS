from flask import Flask, render_template, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from config import Config
from db import close_db
from auth import auth_bp
from layers import layers_bp
from features import features_bp
from ingestion import ingestion_bp


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)

    CORS(app)
    JWTManager(app)

    app.register_blueprint(auth_bp,       url_prefix='/api/v1/auth')
    app.register_blueprint(layers_bp,     url_prefix='/api/v1/layers')
    app.register_blueprint(features_bp,   url_prefix='/api/v1/layers')
    app.register_blueprint(ingestion_bp,  url_prefix='/api/v1/layers')

    app.teardown_appcontext(close_db)

    @app.route('/')
    def index():
        return render_template('index.html')

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
