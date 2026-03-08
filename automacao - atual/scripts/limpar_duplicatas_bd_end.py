#!/usr/bin/env python3
"""
Script para limpar duplicatas do BD_END.xlsx antes da sincronização
Remove duplicatas mantendo apenas o primeiro registro de cada combinação
"""

import pandas as pd
import shutil
from datetime import datetime

def limpar_duplicatas_bd_end():
    """Remove duplicatas do BD_END.xlsx"""
    
    arquivo_original = 'data/BD_END.xlsx'
    arquivo_backup = f'data/BD_END_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
    
    print("=== LIMPEZA DE DUPLICATAS BD_END.xlsx ===\n")
    
    try:
        # Fazer backup
        shutil.copy2(arquivo_original, arquivo_backup)
        print(f"✅ Backup criado: {arquivo_backup}")
        
        # Ler o arquivo Excel
        df = pd.read_excel(arquivo_original, sheet_name='DB_END')
        print(f"📊 Registros originais: {len(df)}")
        
        # Verificar duplicatas na chave única completa
        duplicatas_antes = df.duplicated(subset=['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo'], keep=False).sum()
        print(f"❌ Duplicatas encontradas: {duplicatas_antes}")
        
        if duplicatas_antes > 0:
            # Mostrar algumas duplicatas
            df_dup = df[df.duplicated(subset=['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo'], keep=False)]
            print(f"\n🔍 Exemplos de duplicatas:")
            print(df_dup[['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo', 'descricao']].head(10).to_string(index=False))
            
            # Remover duplicatas (manter primeiro)
            df_limpo = df.drop_duplicates(subset=['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo'], keep='first')
            
            print(f"\n🧹 Após limpeza:")
            print(f"📊 Registros finais: {len(df_limpo)}")
            print(f"🗑️  Registros removidos: {len(df) - len(df_limpo)}")
            
            # Salvar arquivo limpo
            with pd.ExcelWriter(arquivo_original, engine='openpyxl') as writer:
                df_limpo.to_excel(writer, sheet_name='DB_END', index=False)
            
            print(f"✅ Arquivo limpo salvo: {arquivo_original}")
            
            # Verificar se limpeza funcionou
            duplicatas_depois = df_limpo.duplicated(subset=['cd', 'coddv', 'endereco', 'andar', 'validade', 'tipo'], keep=False).sum()
            if duplicatas_depois == 0:
                print("✅ LIMPEZA CONCLUÍDA! Nenhuma duplicata restante")
            else:
                print(f"⚠️  Ainda restam {duplicatas_depois} duplicatas")
                
        else:
            print("✅ Nenhuma duplicata encontrada - arquivo já está limpo")
            
    except Exception as e:
        print(f"❌ Erro na limpeza: {e}")
        # Restaurar backup se houver erro
        try:
            shutil.copy2(arquivo_backup, arquivo_original)
            print(f"🔄 Backup restaurado")
        except:
            pass

if __name__ == "__main__":
    limpar_duplicatas_bd_end()