import { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const webhookUrl = import.meta.env.VITE_DISCORD_WEBHOOK_URL;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export default function App() {
  const [imagePreview, setImagePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [discordStatus, setDiscordStatus] = useState('');

  const [inventory, setInventory] = useState(() => {
    const saved = localStorage.getItem('kaden_inventory');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('kaden_inventory', JSON.stringify(inventory));
  }, [inventory]);

  const sendToDiscord = async (item, type = 'IN', file = null) => {
    if (!webhookUrl) {
      setDiscordStatus('⚠️ DiscordのWebhook URLが未設定です');
      return;
    }

    try {
      const formData = new FormData();
      const isOut = type === 'OUT';

      const payload = {
        username: '家電リサイクルAI',
        embeds: [
          {
            title: isOut
              ? '🚚 【搬出完了】在庫ステータス更新'
              : item.isTarget
              ? '⭕ 【入庫・対象】家電リサイクル対象'
              : '❌ 【対象外】家電リサイクル対象外',
            color: isOut ? 3066993 : item.isTarget ? 15158332 : 3447003,
            fields: [
              { name: '品目', value: item.category || '不明', inline: true },
              { name: 'メーカー', value: item.manufacturer || '不明', inline: true },
              { name: '型番(コード)', value: item.modelNumber || '不明', inline: true },
              { name: '製造業者コード', value: item.makerCode || '空欄', inline: true },
              { name: '入庫(判定)日', value: item.inDate, inline: true },
              {
                name: '搬出完了日',
                value: item.outDate ? item.outDate : '未搬出（在庫保管中）',
                inline: true,
              },
              { name: '備考', value: item.reason || 'なし', inline: false },
            ],
            ...(file ? { image: { url: `attachment://${file.name}` } } : {}),
          },
        ],
      };

      formData.append('payload_json', JSON.stringify(payload));
      if (file) {
        formData.append('files', file, file.name);
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Discord送信失敗');
      setDiscordStatus(
        isOut ? '✅ 搬出完了をDiscordに通知しました！' : '✅ 判定結果をDiscordに送信しました！'
      );
    } catch (err) {
      console.error(err);
      setDiscordStatus('❌ Discordへの送信に失敗しました');
    }
  };

  const handleImageChange = async (e) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const file = fileList.item(0);

    setImagePreview(URL.createObjectURL(file));
    setResult(null);
    setDiscordStatus('');
    setLoading(true);

    try {
      if (!ai) {
        throw new Error('APIキーが読み込まれていません。.envファイルを確認してください。');
      }

      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const parts = String(reader.result).split(',');
          resolve(parts.at(1));
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const prompt = `
        この画像に写っている家電製品の銘板シール・型番（家電コード）および外観を解析し、日本の「家電リサイクル法」の対象品目かどうかを判定してください。

        【重要判定ルール】
        1. 読み取った「型番（家電コード）」の仕様・シリーズから品目とメーカーを特定すること。
        2. 対象4品目：エアコン、テレビ（ブラウン管・液晶・プラズマ）、冷蔵庫・冷凍庫、洗濯機・衣類乾燥機。
        3. 【特別ルール】ルームエアコン（家庭用エアコン）については、通常の壁掛け型だけでなく「天井埋込形」「壁埋込形」（ハウジングエアコン・マルチエアコン室内機等）もすべて家電リサイクル対象（isTarget: true）として判定すること。※店舗・オフィス用の業務用パッケージエアコンのみ対象外とする。
        4. 製造業者コード（家電リサイクル券の3桁コード）が特定できる場合は記載し、不明または対象外の場合は空文字("")にすること。

        必ず以下のJSON形式のみで回答してください。
        {
          "isTarget": true または false,
          "category": "品目名（例：ルームエアコン(天井埋込)、冷蔵庫、電子レンジ など）",
          "manufacturer": "メーカー名（不明な場合は「不明」）",
          "makerCode": "3桁の製造業者コード（不明・対象外は空文字）",
          "modelNumber": "読み取れた型番・家電コード（不明な場合は「不明」）",
          "reason": "型番に基づく判定理由や埋込式などの補足（1〜2文）"
        }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: file.type,
            },
          },
          prompt,
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const parsed = JSON.parse(response.text);
      const today = new Date().toLocaleDateString('ja-JP');

      const newItem = {
        id: Date.now(),
        inDate: today,
        outDate: '',
        status: '在庫保管中',
        siteName: '',
        driverName: '',
        ...parsed,
      };

      setResult(newItem);
      setInventory((prev) => [newItem, ...prev]);
      await sendToDiscord(newItem, 'IN', file);
    } catch (error) {
      console.error(error);
      alert('エラー: ' + error.message);
    } finally {
      setLoading(false);
    }
  };
  const handleCompleteShipment = async (id) => {
    const today = new Date().toLocaleDateString('ja-JP');
    let targetItem = null;

    const updated = inventory.map((item) => {
      if (item.id === id) {
        targetItem = {
          ...item,
          status: '搬出完了',
          outDate: today,
        };
        return targetItem;
      }
      return item;
    });

    setInventory(updated);
    if (targetItem) {
      await sendToDiscord(targetItem, 'OUT');
    }
  };

  const handleDelete = (id) => {
    if (!window.confirm('この履歴をリストから削除しますか？')) return;
    setInventory((prev) => prev.filter((item) => item.id !== id));
  };

  const exportToCSV = () => {
    const headers = [
      '入庫日',
      'ステータス',
      '搬出完了日',
      '対象判定',
      '品目',
      'メーカー',
      '製造業者コード',
      '型番(家電コード)',
      '現場名',
      'ドライバー名',
      '備考',
    ];

    const rows = inventory.map((item) => [
      item.inDate,
      item.status,
      item.outDate,
      item.isTarget ? '対象' : '対象外',
      item.category,
      item.manufacturer,
      item.makerCode || '',
      item.modelNumber,
      item.siteName || '',
      item.driverName || '',
      item.reason,
    ]);

    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `家電リサイクル在庫管理_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '-')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ maxWidth: '650px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>家電リサイクルAI</h2>

      <label
        style={{
          display: 'block',
          padding: '15px',
          backgroundColor: '#0066cc',
          color: '#fff',
          textAlign: 'center',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: '16px',
        }}
      >
        📷 型番(家電コード)を撮影 / 画像選択
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageChange}
          style={{ display: 'none' }}
        />
      </label>

      {imagePreview && (
        <div style={{ marginTop: '15px', textAlign: 'center' }}>
          <img
            src={imagePreview}
            alt="プレビュー"
            style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px' }}
          />
        </div>
      )}

      {loading && (
        <p style={{ textAlign: 'center', marginTop: '15px', fontWeight: 'bold' }}>
          AIが型番を解析＆在庫登録中...
        </p>
      )}

      {result && (
        <div
          style={{
            marginTop: '15px',
            padding: '15px',
            borderRadius: '8px',
            backgroundColor: result.isTarget ? '#ffeaea' : '#eef7ff',
            border: `2px solid ${result.isTarget ? '#e60000' : '#0066cc'}`,
          }}
        >
          <h3 style={{ margin: '0 0 10px 0', color: result.isTarget ? '#e60000' : '#0066cc' }}>
            {result.isTarget ? '⭕ 家電リサイクル対象（在庫に追加済）' : '❌ 対象外'}
          </h3>
          <p style={{ margin: '4px 0' }}>
            <strong>型番(コード)：</strong>
            {result.modelNumber}
          </p>
          <p style={{ margin: '4px 0' }}>
            <strong>品目：</strong>
            {result.category}
          </p>
          <p style={{ margin: '4px 0' }}>
            <strong>メーカー：</strong>
            {result.manufacturer} {result.makerCode && `(コード: ${result.makerCode})`}
          </p>
          <p style={{ margin: '4px 0' }}>
            <strong>判定根拠：</strong>
            {result.reason}
          </p>
          {discordStatus && (
            <p style={{ marginTop: '8px', fontWeight: 'bold', color: '#222' }}>{discordStatus}</p>
          )}
        </div>
      )}

      <div style={{ marginTop: '30px', borderTop: '2px solid #ddd', paddingTop: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px',
          }}
        >
          <h3 style={{ margin: 0 }}>📦 在庫管理リスト（全 {inventory.length} 件）</h3>
          {inventory.length > 0 && (
            <button
              onClick={exportToCSV}
              style={{
                padding: '8px 14px',
                backgroundColor: '#1d6f42',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              📊 Excel用CSV出力
            </button>
          )}
        </div>

        {inventory.length === 0 ? (
          <p style={{ color: '#666' }}>
            まだ登録された在庫はありません。上のボタンから撮影してください。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {inventory.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #ccc',
                  backgroundColor: item.status === '搬出完了' ? '#f4f4f4' : '#fff',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: item.status === '搬出完了' ? '#666' : '#ff9800',
                      color: '#fff',
                    }}
                  >
                    {item.status}
                  </span>
                  <span style={{ fontSize: '12px', color: '#555' }}>
                    入庫日: {item.inDate} {item.outDate && ` / 搬出完了日: ${item.outDate}`}
                  </span>
                </div>

                <div style={{ marginTop: '8px', fontSize: '14px' }}>
                  <strong>{item.isTarget ? '⭕対象' : '❌対象外'}</strong> ｜{' '}
                  <strong>{item.category}</strong> ｜ {item.manufacturer}（型番:{' '}
                  <code>{item.modelNumber}</code>）
                </div>

                <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
                  {item.status !== '搬出完了' && (
                    <button
                      onClick={() => handleCompleteShipment(item.id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#0066cc',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 'bold',
                      }}
                    >
                      🚚 搬出完了にする
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(item.id)}
                    style={{
                      padding: '6px 10px',
                      backgroundColor: '#eee',
                      color: '#333',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
