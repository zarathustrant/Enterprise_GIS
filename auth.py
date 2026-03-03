from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token, create_refresh_token,
    jwt_required, get_jwt_identity,
)
from werkzeug.security import generate_password_hash, check_password_hash
from db import get_db

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not username or not email or not password:
        return jsonify({'error': 'username, email, and password are required'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    db = get_db()
    cur = db.cursor()
    cur.execute(
        "SELECT id FROM users WHERE username = %s OR email = %s",
        (username, email)
    )
    if cur.fetchone():
        return jsonify({'error': 'Username or email already taken'}), 409

    cur.execute(
        "INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s) RETURNING id, username, email",
        (username, email, generate_password_hash(password))
    )
    user = cur.fetchone()
    # Assign viewer role by default
    cur.execute(
        "INSERT INTO user_roles (user_id, role_id) SELECT %s, id FROM roles WHERE name = 'viewer'",
        (user['id'],)
    )
    db.commit()

    return jsonify({
        'user': {'id': str(user['id']), 'username': user['username'], 'email': user['email']},
        'access_token': create_access_token(identity=str(user['id'])),
        'refresh_token': create_refresh_token(identity=str(user['id'])),
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': 'username and password are required'}), 400

    db = get_db()
    cur = db.cursor()
    cur.execute(
        "SELECT id, username, email, password_hash FROM users WHERE username = %s AND is_active = TRUE",
        (username,)
    )
    user = cur.fetchone()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid credentials'}), 401

    return jsonify({
        'user': {'id': str(user['id']), 'username': user['username'], 'email': user['email']},
        'access_token': create_access_token(identity=str(user['id'])),
        'refresh_token': create_refresh_token(identity=str(user['id'])),
    })


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    return jsonify({'access_token': create_access_token(identity=get_jwt_identity())})


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def me():
    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT u.id, u.username, u.email, u.created_at,
               COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.id = %s::uuid
        GROUP BY u.id
    """, (get_jwt_identity(),))
    user = cur.fetchone()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({
        'id': str(user['id']),
        'username': user['username'],
        'email': user['email'],
        'roles': list(user['roles']),
        'created_at': user['created_at'].isoformat(),
    })
