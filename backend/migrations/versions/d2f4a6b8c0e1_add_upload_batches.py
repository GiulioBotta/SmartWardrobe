"""add upload_batches and upload_photos for the batch upload inbox

Revision ID: d2f4a6b8c0e1
Revises: c8e1f2a3b4d5
Create Date: 2026-10-27

"""

from collections.abc import Sequence

from alembic import op

revision: str = "d2f4a6b8c0e1"
down_revision: str | None = "c8e1f2a3b4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Photos stay here until the user confirms them in the inbox, so clothing_items and
    # everything reading it (suggestions, embeddings cron, analytics) never see them early.
    op.execute(
        """
        CREATE TABLE upload_batches (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL DEFAULT 'uploading',
            sealed_at TIMESTAMPTZ,
            paused_until TIMESTAMPTZ,
            pause_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_upload_batches_user_id ON upload_batches (user_id)")
    op.execute(
        """
        CREATE TABLE upload_photos (
            id UUID PRIMARY KEY,
            batch_id UUID NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            upload_key VARCHAR(64),
            filename VARCHAR(255),
            image_path VARCHAR(500) NOT NULL,
            thumbnail_path VARCHAR(500),
            medium_path VARCHAR(500),
            original_image_path VARCHAR(500),
            image_hash VARCHAR(16),
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            embedding_model VARCHAR(100),
            embedding vector(512),
            group_id UUID,
            is_primary BOOLEAN NOT NULL DEFAULT false,
            tags JSONB,
            duplicate_of_item_id UUID REFERENCES clothing_items(id) ON DELETE SET NULL,
            duplicate_score DOUBLE PRECISION,
            item_id UUID REFERENCES clothing_items(id) ON DELETE SET NULL,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_upload_photos_user_upload_key UNIQUE (user_id, upload_key)
        )
        """
    )
    op.execute("CREATE INDEX ix_upload_photos_batch_id ON upload_photos (batch_id, position)")
    op.execute("CREATE INDEX ix_upload_photos_status ON upload_photos (status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS upload_photos")
    op.execute("DROP TABLE IF EXISTS upload_batches")
