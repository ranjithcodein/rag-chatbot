"""
RAG Document Q&A Chatbot — Flask backend (PostgreSQL + HuggingFace version)
"""

import os
import uuid
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import psycopg2
import psycopg2.extras

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma

import requests

class SimpleHFEmbeddings:
    def __init__(self, api_key, model_name="sentence-transformers/all-MiniLM-L6-v2"):
        self.api_key = api_key
        self.url = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{model_name}"

    def embed_documents(self, texts):
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.post(self.url, headers=headers, json={"inputs": texts})
        return response.json()

    def embed_query(self, text):
        return self.embed_documents([text])[0]


# ---------- App setup ----------

app = Flask(__name__)
CORS(app)

app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET_KEY", "dev-secret-change-me")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=7)
jwt = JWTManager(app)

UPLOAD_FOLDER = "uploads"
CHROMA_PERSIST_DIR = "chroma_store"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)

embeddings = SimpleHFEmbeddings(api_key=os.environ.get("HF_API_TOKEN"))
HF_API_TOKEN = os.environ.get("HF_API_TOKEN")


def ask_huggingface(prompt):
    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {HF_API_TOKEN}",
        "Content-Type": "application/json"
    }
    data = {
        "model": "meta-llama/Llama-3.1-8B-Instruct",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 500
    }
    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        raise Exception(f"Hugging Face API error: {response.text}")
    result = response.json()
    return result["choices"][0]["message"]["content"]


def get_db():
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=os.environ.get("DB_PORT", "5432"),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        dbname=os.environ.get("DB_NAME", "rag_chatbot"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


# ---------- Auth routes ----------

@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.get_json()
    name, email, password = data.get("name"), data.get("email"), data.get("password")

    if not all([name, email, password]):
        return jsonify({"error": "Name, email, and password are required."}), 400

    password_hash = generate_password_hash(password)
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            if cur.fetchone():
                return jsonify({"error": "An account with this email already exists."}), 409

            cur.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (%s, %s, %s) RETURNING id",
                (name, email, password_hash),
            )
            user_id = cur.fetchone()["id"]
            conn.commit()

        token = create_access_token(identity=str(user_id))
        return jsonify({"token": token, "user": {"id": user_id, "name": name, "email": email}}), 201
    finally:
        conn.close()


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    email, password = data.get("email"), data.get("password")

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            user = cur.fetchone()

        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Invalid email or password."}), 401

        token = create_access_token(identity=str(user["id"]))
        return jsonify({"token": token, "user": {"id": user["id"], "name": user["name"], "email": user["email"]}})
    finally:
        conn.close()


# ---------- Document routes ----------

@app.route("/api/documents", methods=["GET"])
@jwt_required()
def list_documents():
    user_id = get_jwt_identity()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, original_name, uploaded_at FROM documents WHERE user_id = %s ORDER BY uploaded_at DESC",
                (user_id,),
            )
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/upload", methods=["POST"])
@jwt_required()
def upload_document():
    user_id = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({"error": "No file provided."}), 400

    file = request.files["file"]
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported."}), 400

    filename = secure_filename(file.filename)
    saved_path = os.path.join(UPLOAD_FOLDER, f"{uuid.uuid4()}_{filename}")
    file.save(saved_path)

    collection_name = f"doc_{uuid.uuid4().hex[:16]}"

    try:
        loader = PyPDFLoader(saved_path)
        pages = loader.load()

        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)
        chunks = splitter.split_documents(pages)

        if not chunks:
            return jsonify({"error": "Couldn't extract any text from that PDF."}), 422

        Chroma.from_documents(
            documents=chunks,
            embedding=embeddings,
            collection_name=collection_name,
            persist_directory=CHROMA_PERSIST_DIR,
        )

        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO documents (user_id, original_name, chroma_collection) VALUES (%s, %s, %s) RETURNING id",
                    (user_id, filename, collection_name),
                )
                document_id = cur.fetchone()["id"]
                conn.commit()
        finally:
            conn.close()

        return jsonify({"document_id": document_id, "filename": filename, "chunks_indexed": len(chunks)}), 201
    finally:
        os.remove(saved_path)


# ---------- Chat routes ----------

@app.route("/api/chat/<int:document_id>", methods=["GET"])
@jwt_required()
def get_chat_history(document_id):
    user_id = get_jwt_identity()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM documents WHERE id = %s AND user_id = %s", (document_id, user_id))
            if not cur.fetchone():
                return jsonify({"error": "Document not found."}), 404

            cur.execute(
                "SELECT role, content, created_at FROM chat_messages WHERE document_id = %s ORDER BY created_at ASC",
                (document_id,),
            )
            return jsonify(cur.fetchall())
    finally:
        conn.close()


@app.route("/api/chat/<int:document_id>", methods=["POST"])
@jwt_required()
def chat(document_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    question = (data.get("question") or "").strip()

    if not question:
        return jsonify({"error": "Question cannot be empty."}), 400

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT chroma_collection FROM documents WHERE id = %s AND user_id = %s",
                (document_id, user_id),
            )
            doc = cur.fetchone()
            if not doc:
                return jsonify({"error": "Document not found."}), 404

            cur.execute(
                "INSERT INTO chat_messages (document_id, role, content) VALUES (%s, 'user', %s)",
                (document_id, question),
            )
            conn.commit()

        vectorstore = Chroma(
            collection_name=doc["chroma_collection"],
            embedding_function=embeddings,
            persist_directory=CHROMA_PERSIST_DIR,
        )
        results = vectorstore.similarity_search(question, k=4)
        context = "\n\n".join(r.page_content for r in results)

        prompt = (
            "Answer the question using only the context below. "
            "If the answer isn't in the context, say you don't know.\n\n"
            f"Context:\n{context}\n\nQuestion: {question}"
        )

        answer = ask_huggingface(prompt)
        sources = [{"text": r.page_content[:200]} for r in results]

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (document_id, role, content) VALUES (%s, 'assistant', %s)",
                (document_id, answer),
            )
            conn.commit()

        return jsonify({"answer": answer, "sources": sources})
    finally:
        conn.close()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)