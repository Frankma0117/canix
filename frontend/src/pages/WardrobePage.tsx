import { useEffect, useState } from 'react';
import { useApi, errMsg } from '../services/api.ts';
import type { GarmentDetail, WardrobeReviewStatus, WardrobeTaxonomy } from '../types/index.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { ReviewTab } from '../components/organisms/wardrobe/ReviewTab.tsx';
import { WardrobeGrid } from '../components/organisms/wardrobe/WardrobeGrid.tsx';

type Tab = 'wardrobe' | 'review';

export function WardrobePage() {
  const api = useApi();
  // The link Canix sends over WhatsApp opens straight on the questions (#/wardrobe?tab=review).
  const [tab, setTab] = useState<Tab>(() => (window.location.hash.includes('tab=review') ? 'review' : 'wardrobe'));
  const [taxonomy, setTaxonomy] = useState<WardrobeTaxonomy | null>(null);
  const [status, setStatus] = useState<WardrobeReviewStatus | null>(null);
  const [review, setReview] = useState<GarmentDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever a garment changes from the other tab, so the grid reloads.
  const [version, setVersion] = useState(0);

  async function loadReview() {
    try {
      const data = await api.get<{ status: WardrobeReviewStatus; garments: GarmentDetail[] }>('/api/garments/review');
      setStatus(data.status);
      setReview(data.garments);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  useEffect(() => {
    api.get<WardrobeTaxonomy>('/api/garments/taxonomy').then(setTaxonomy).catch((e) => setError(errMsg(e)));
    loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // While the background classification is going through the wardrobe, keep the numbers moving.
  useEffect(() => {
    if (!status?.pending) return;
    const timer = setInterval(loadReview, 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.pending]);

  return (
    <Page
      title="Mi armario"
      wide
      description="Para agregar prendas, mándale la foto a Canix por WhatsApp. Cada foto se clasifica sola; lo que no quede claro te lo pregunto aquí."
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'wardrobe', label: 'Armario', count: status?.total },
          { id: 'review', label: 'Por revisar', count: status?.main_garments ?? 0 },
        ]}
      />
      {tab === 'wardrobe' ? (
        <WardrobeGrid api={api} taxonomy={taxonomy} version={version} onChanged={loadReview} onError={setError} />
      ) : (
        <ReviewTab
          api={api}
          taxonomy={taxonomy}
          status={status}
          garments={review}
          onChanged={() => {
            setVersion((v) => v + 1);
            return loadReview();
          }}
          onError={setError}
        />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------------------------
// Armario
// ---------------------------------------------------------------------------------------------
