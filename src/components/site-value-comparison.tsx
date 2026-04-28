'use client';

import {
    calculateSiteValueComparison,
    formatCnyAmount,
    SITE_IMAGES_PER_CNY,
    SITE_CNY_PER_IMAGE
} from '@/lib/cost-utils';
import { useI18n } from '@/lib/i18n';
import { BadgePercent } from 'lucide-react';

type SiteValueComparisonProps = {
    officialUsdCost: number;
    imageCount: number;
};

export function SiteValueComparison({ officialUsdCost, imageCount }: SiteValueComparisonProps) {
    const { t } = useI18n();
    const comparison = calculateSiteValueComparison(officialUsdCost, imageCount);
    const hasSavings = comparison.savingsCny > 0;
    const multiplier = comparison.valueMultiplier.toFixed(1);

    return (
        <div className='rounded-md border border-emerald-400/25 bg-emerald-400/10 p-3 text-emerald-50'>
            <div className='flex items-center gap-2'>
                <BadgePercent className='h-4 w-4 text-emerald-300' />
                <p className='text-sm font-medium'>{t('valueComparison.title')}</p>
            </div>

            <div className='mt-3 grid grid-cols-2 gap-2 text-xs text-emerald-50/75'>
                <div className='rounded border border-emerald-300/15 bg-black/20 p-2'>
                    <p>{t('valueComparison.officialEstimate')}</p>
                    <p className='mt-1 text-sm font-medium text-white'>{formatCnyAmount(comparison.officialCostCny)}</p>
                </div>
                <div className='rounded border border-emerald-300/15 bg-black/20 p-2'>
                    <p>{t('valueComparison.siteQuota')}</p>
                    <p className='mt-1 text-sm font-medium text-white'>{formatCnyAmount(comparison.siteCostCny, 2)}</p>
                </div>
                <div className='rounded border border-emerald-300/15 bg-black/20 p-2'>
                    <p>{t('valueComparison.officialPerImage')}</p>
                    <p className='mt-1 text-sm font-medium text-white'>
                        {formatCnyAmount(comparison.officialCostPerImageCny)}
                    </p>
                </div>
                <div className='rounded border border-emerald-300/15 bg-black/20 p-2'>
                    <p>{t('valueComparison.sitePerImage')}</p>
                    <p className='mt-1 text-sm font-medium text-white'>
                        {formatCnyAmount(comparison.siteCostPerImageCny, 2)}
                    </p>
                </div>
            </div>

            <p className='mt-3 text-xs text-emerald-50/80'>
                {t('valueComparison.quotaLine', {
                    count: SITE_IMAGES_PER_CNY,
                    price: SITE_CNY_PER_IMAGE.toFixed(2)
                })}
            </p>
            <p className='mt-1 text-xs text-emerald-50/60'>{t('valueComparison.sourceLine')}</p>
            <p className='mt-1 text-sm font-medium text-emerald-100'>
                {hasSavings
                    ? t('valueComparison.goodDeal', {
                          multiplier,
                          savings: formatCnyAmount(comparison.savingsCny),
                          percent: Math.max(0, comparison.savingsPercent).toFixed(0)
                      })
                    : t('valueComparison.fixedDeal')}
            </p>
        </div>
    );
}
