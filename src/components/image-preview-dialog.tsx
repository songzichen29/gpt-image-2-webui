'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { Download } from 'lucide-react';
import Image from 'next/image';

export type PreviewImage = {
    src: string;
    filename: string;
    alt?: string;
};

type ImagePreviewDialogProps = {
    image: PreviewImage | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function ImagePreviewDialog({ image, open, onOpenChange }: ImagePreviewDialogProps) {
    const { t } = useI18n();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className='max-h-[92vh] border-neutral-700 bg-neutral-950 p-4 text-white sm:max-w-[92vw]'>
                <DialogHeader className='pr-8'>
                    <DialogTitle className='truncate text-white'>
                        {image?.filename || t('output.previewTitle')}
                    </DialogTitle>
                    <DialogDescription className='sr-only'>{t('output.previewDescription')}</DialogDescription>
                </DialogHeader>
                {image && (
                    <div className='relative h-[70vh] min-h-[320px] w-full overflow-hidden rounded-md bg-black'>
                        <Image
                            src={image.src}
                            alt={image.alt || image.filename}
                            fill
                            className='object-contain'
                            sizes='92vw'
                            unoptimized
                        />
                    </div>
                )}
                <DialogFooter>
                    {image && (
                        <Button
                            asChild
                            type='button'
                            variant='outline'
                            size='sm'
                            className='border-white/20 text-white/80 hover:bg-white/10 hover:text-white'>
                            <a href={image.src} download={image.filename}>
                                <Download className='h-4 w-4' />
                                {t('common.download')}
                            </a>
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
