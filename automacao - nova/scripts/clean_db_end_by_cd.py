#!/usr/bin/env python3
"""
Script para limpar registros antigos do DB_END por CD antes da sincronização
Garante que o banco seja um espelho exato do Excel
"""

import os
import pandas as pd
import psycopg2
from dotenv import load_dotenv

def clean_db_end_by_cd():
    """Remove registros antigos do DB_END baseado nos CDs presentes no Excel"""
    
    # Carregar variáveis de ambiente
    load_dotenv()
    
    # Ler o arquivo Excel para obter os CDs únicos
    excel_file = "data/BD_END.xlsx"
    if not os.path.exists(excel_file):
        print(f"❌ Arquivo {excel_file} não encontrado")
        return False
    
    try:
        # Ler dados do Excel
        df = pd.read_excel(excel_file, sheet_name="DB_END")
        cds_no_excel = df['cd'].unique().tolist()
        
        print(f"📊 CDs encontrados no Excel: {len(cds_no_excel)}")
        
        # Conectar ao Supabase
        conn = psycopg2.connect(
            host=os.getenv('SUPABASE_DB_HOST'),
            port=os.getenv('SUPABASE_DB_PORT'),
            database=os.getenv('SUPABASE_DB_NAME'),
            user=os.getenv('SUPABASE_DB_USER'),
            password=os.getenv('SUPABASE_DB_PASSWORD')
        )
        
        cursor = conn.cursor()
        
        # Para cada CD no Excel, limpar registros antigos
        for cd in cds_no_excel:
            cursor.execute(
                "DELETE FROM app.db_end WHERE cd = %s",
                (cd,)
            )
            
        conn.commit()
        print(f"✅ Limpeza concluída para {len(cds_no_excel)} CDs")
        
        cursor.close()
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Erro na limpeza: {e}")
        return False

if __name__ == "__main__":
    clean_db_end_by_cd()