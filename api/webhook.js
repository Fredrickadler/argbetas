// api/webhook.js
import { createClient } from '@supabase/supabase-js';

// مقداردهی دیتابیس با متغیرهای محیطی که در Vercel ست کرده‌اید
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default async function handler(req, res) {
    // فقط درخواست‌های POST مجاز هستند
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body;
        
        // دریافت اطلاعات مهم ارسال شده از سمت درگاه NOWPayments
        const orderId = body.order_id;       // همان ARGUS-timestamp
        const paymentStatus = body.payment_status; // وضعیت پرداخت (مثلا 'finished', 'failed', 'expired')

        if (!orderId) {
            return res.status(400).json({ error: 'Missing order_id' });
        }

        // ۱. اگر وضعیت پرداخت در درگاه موفقیت‌آمیز (finished) بود:
        if (paymentStatus === 'finished') {
            
            // الف) به‌روزرسانی وضعیت تراکنش به completed در جدول transactions
            const { data: updatedTx, error: txError } = await supabase
                .from('transactions')
                .update({ status: 'completed' })
                .eq('order_id', orderId)
                .select('user_id, plan_name')
                .single();

            if (txError) throw txError;

            // ب) فعال‌سازی اشتراک کاربر در جدول users
            if (updatedTx && updatedTx.user_id) {
                // محاسبه تاریخ انقضا بر اساس پلان خریداری شده
                let monthsToAdd = 1;
                if (updatedTx.plan_name.includes('12')) monthsToAdd = 12;
                if (updatedTx.plan_name.includes('6')) monthsToAdd = 6;

                const expiryDate = new Date();
                expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);

                const { error: userError } = await supabase
                    .from('users')
                    .update({
                        subscription_status: 'active',
                        subscription_expires_at: expiryDate.toISOString()
                    })
                    .eq('id', updatedTx.user_id);

                if (userError) throw userError;
            }

        } 
        // ۲. اگر فاکتور منقضی یا ناموفق شد:
        else if (paymentStatus === 'failed' || paymentStatus === 'expired') {
            await supabase
                .from('transactions')
                .update({ status: 'failed' })
                .eq('order_id', orderId);
        }

        // پاسخ به درگاه که عملیات با موفقیت در سرور ما پردازش شد
        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error('Webhook Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
