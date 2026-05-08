import Dexie, { type EntityTable } from 'dexie';

export const LEGACY_IMAGE_USER_ID = 0;

export interface ImageRecord {
    userId: number;
    filename: string;
    blob: Blob;
}

export class ImageDB extends Dexie {
    images!: EntityTable<ImageRecord, 'filename'>;

    constructor() {
        super('ImageDB');

        this.version(1).stores({
            images: '&filename'
        });

        this.version(2)
            .stores({
                images: '&[userId+filename], userId, filename'
            })
            .upgrade((tx) =>
                tx
                    .table('images')
                    .toCollection()
                    .modify((record) => {
                        record.userId = LEGACY_IMAGE_USER_ID;
                    })
            );

        this.images = this.table('images');
    }
}

export const db = new ImageDB();
