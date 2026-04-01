#!/usr/bin/env python3
"""
Script completo para verificar consistência entre Excel e Supabase
Analisa endereços duplicados e compara dados
"""

import pandas as pd
import psycopg2
from dotenv import load_dotenv
import os

def verificar_endereco_completo():
    """Verifica consistência entre Excel e banco Supabase"""
    
    # Carregar variáveis de ambiente
    load_dotenv()
    
    print("=== VERIFICAÇÃO COMPLETA DE ENDEREÇOS ===\n")
    
    # 1. ANÁLISE DO EXCEL
    print("📊 ANALISANDO EXCEL...")
    try:
        df_excel = pd.read_excel('data/BD_END.xlsx', sheet_name='DB_END')
        print(f"✅ Excel carregado: {len(df_excel)} registros")
        
        # Estatísticas do Excel
        enderecos_excel = df_excel.groupby('endereco')['coddv'].count()
        multiplos_excel = enderecos_excel[enderecos_excel > 1]
        
        print(f"📍 Endereços únicos no Excel: {df_excel['endereco'].nunique()}")
        print(f"⚠️  Endereços com múltiplos produtos: {len(multiplos_excel)}")
        
        if len(multiplos_excel) > 0:
            print("\n🔍 Top 5 endereços com mais produtos:")
            print(multiplos_excel.sort_values(ascending=False).head().to_string())
        
    except Exception as e:
        print(f"❌ Erro ao ler Excel: {e}")
        return
    
    # 2. ANÁLISE DO SUPABASE
    print(f"\n🔗 CONECTANDO AO SUPABASE...")
    try:
        conn = psycopg2.connect(
            host=os.getenv('SUPABASE_DB_HOST'),
            port=os.getenv('SUPABASE_DB_PORT'),
            database=os.getenv('SUPABASE_DB_NAME'),
            user=os.getenv('SUPABASE_DB_USER'),
            password=os.getenv('SUPABASE_DB_PASSWORD')
        )
        
        # Buscar dados do banco
        df_banco = pd.read_sql(
            "SELECT cd, coddv, endereco, descricao, tipo FROM app.db_end ORDER BY endereco, coddv",
            conn
        )
        
        print(f"✅ Banco consultado: {len(df_banco)} registros")
        
        # Estatísticas do banco
        enderecos_banco = df_banco.groupby('endereco')['coddv'].count()
        multiplos_banco = enderecos_banco[enderecos_banco > 1]
        
        print(f"📍 Endereços únicos no banco: {df_banco['endereco'].nunique()}")
        print(f"⚠️  Endereços com múltiplos produtos: {len(multiplos_banco)}")
        
        conn.close()
        
    except Exception as e:
        print(f"❌ Erro ao conectar Supabase: {e}")
        return
    
    # 3. COMPARAÇÃO
    print(f"\n🔄 COMPARANDO EXCEL vs BANCO...")
    
    # Comparar totais
    diff_registros = len(df_excel) - len(df_banco)
    diff_enderecos = df_excel['endereco'].nunique() - df_banco['endereco'].nunique()
    diff_multiplos = len(multiplos_excel) - len(multiplos_banco)
    
    print(f"📊 Diferença de registros: {diff_registros:+d}")
    print(f"📍 Diferença de endereços únicos: {diff_enderecos:+d}")
    print(f"⚠️  Diferença de endereços com múltiplos: {diff_multiplos:+d}")
    
    # Verificar se são idênticos
    if diff_registros == 0 and diff_enderecos == 0:
        print("✅ PERFEITO! Excel e banco estão sincronizados")
    else:
        print("⚠️  ATENÇÃO! Há diferenças entre Excel e banco")
        print("💡 Execute a sincronização para corrigir")
    
    # 4. ANÁLISE ESPECÍFICA (se solicitado)
    endereco_teste = 'AL2.006.003.004'
    print(f"\n🔍 ANÁLISE ESPECÍFICA: {endereco_teste}")
    
    excel_teste = df_excel[df_excel['endereco'] == endereco_teste]
    banco_teste = df_banco[df_banco['endereco'] == endereco_teste]
    
    print(f"Excel: {len(excel_teste)} registros")
    print(f"Banco: {len(banco_teste)} registros")
    
    if len(excel_teste) > 0:
        print("\nExcel:")
        print(excel_teste[['cd', 'coddv', 'descricao', 'endereco']].to_string(index=False))
    
    if len(banco_teste) > 0:
        print("\nBanco:")
        print(banco_teste[['cd', 'coddv', 'descricao', 'endereco']].to_string(index=False))

if __name__ == "__main__":
    verificar_endereco_completo()