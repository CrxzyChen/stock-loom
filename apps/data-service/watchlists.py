from provider import ProviderError


class Watchlists:
    def require_group(self, group):
        if not isinstance(group,str) or not self.db.execute('SELECT 1 FROM watchlists WHERE id=?',(group,)).fetchone():
            raise ProviderError('GROUP_NOT_FOUND','自选分组不存在，请刷新列表。')

    def members(self, params):
        if set(params) != {'listId'}: raise ProviderError('INVALID_PARAMS','分组参数无效。')
        self.require_group(params['listId'])
        rows=self.db.execute('''SELECT i.id,i.name,i.exchange,i.list_status AS listStatus,i.list_date AS listDate,i.delist_date AS delistDate
            FROM watchlist_items w JOIN instruments i ON i.id=w.instrument_id WHERE w.list_id=? ORDER BY w.position,i.id''',(params['listId'],))
        return [dict(row) for row in rows]

    def change_member(self, params, add):
        if set(params) != {'listId','instrumentId'} or not isinstance(params['instrumentId'],str):
            raise ProviderError('INVALID_PARAMS','股票参数无效。')
        group, code=params['listId'],params['instrumentId']
        self.require_group(group)
        if not self.db.execute('SELECT 1 FROM instruments WHERE id=?',(code,)).fetchone():
            raise ProviderError('INSTRUMENT_NOT_FOUND','请先同步股票目录并选择有效股票。')
        with self.db:
            if add:
                exists=self.db.execute('SELECT 1 FROM watchlist_items WHERE list_id=? AND instrument_id=?',(group,code)).fetchone()
                if not exists:
                    count=self.db.execute('SELECT COUNT(*) FROM watchlist_items WHERE list_id=?',(group,)).fetchone()[0]
                    if count >= 500: raise ProviderError('GROUP_FULL','每组最多 500 只股票，请建立新分组。')
                    position=self.db.execute('SELECT COALESCE(MAX(position),-1)+1 FROM watchlist_items WHERE list_id=?',(group,)).fetchone()[0]
                    self.db.execute('INSERT INTO watchlist_items VALUES (?,?,?)',(group,code,position))
            else:
                self.db.execute('DELETE FROM watchlist_items WHERE list_id=? AND instrument_id=?',(group,code))
        return self.members({'listId':group})

    def reorder_members(self, params):
        if set(params) != {'listId','ids'} or not isinstance(params['ids'],list) or len(params['ids'])>500 or any(not isinstance(x,str) for x in params['ids']):
            raise ProviderError('INVALID_PARAMS','排序参数无效。')
        current=self.members({'listId':params['listId']})
        ids=params['ids']
        if len(set(ids)) != len(ids) or set(ids) != {x['id'] for x in current}:
            raise ProviderError('STALE_LIST','分组成员已变化，请刷新后重新排序。')
        with self.db:
            self.db.executemany('UPDATE watchlist_items SET position=? WHERE list_id=? AND instrument_id=?',[(i,params['listId'],code) for i,code in enumerate(ids)])
        return self.members({'listId':params['listId']})
