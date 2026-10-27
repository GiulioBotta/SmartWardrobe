"""add item_embeddings (pgvector) for image similarity

Revision ID: c8e1f2a3b4d5
Revises: a7d3c9e1f5b2
Create Date: 2026-10-27

"""

from collections.abc import Sequence

from alembic import op

revision: str = "c8e1f2a3b4d5"
down_revision: str | None = "a7d3c9e1f5b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Needs the pgvector-enabled postgres image (docker/postgres/Dockerfile).
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    # A separate table rather than a column on clothing_items, so the upstream model stays
    # untouched and a model change only means recomputing these rows.
    op.execute(
        """
        CREATE TABLE item_embeddings (
            item_id UUID PRIMARY KEY REFERENCES clothing_items(id) ON DELETE CASCADE,
            model VARCHAR(100) NOT NULL,
            embedding vector(512) NOT NULL,
            source_path VARCHAR(500),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_item_embeddings_cosine ON item_embeddings "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS item_embeddings")
    # The extension stays: other databases on the server may use it.
