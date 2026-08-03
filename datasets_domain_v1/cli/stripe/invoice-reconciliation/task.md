Accounting 刚把 May wholesale ledger 发过来了，明早就 month-end close，需要在那之前把 Stripe 同步好。请把 ledger 里的每条 line item 跟 Stripe 里已有的 customer 对上，把 invoice 都建起来。ledger 里还夹了一些 account note，也要落到对应 customer 记录上。

完成后在 `outputs/reconciliation.json` 里写一份对账汇总，方便 controller 复核。
