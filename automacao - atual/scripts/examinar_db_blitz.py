#!/usr/bin/env python3
"""
Script para examinar o arquivo DB_BLITZ.xlsx e identificar suas abas e estrutura
"""
import pandas as pd
import os

def examinar_db_blitz():
    """Examina o arquivo DB_BLITZ.xlsx"""
    
    arquivo = 'data/DB_BLITZ.xlsx'
    
    if not os.path.exists(arquivo):
        print(f"❌ Arquivo {arquivo} não encontrado")
        return
    
    print("=== EXAMINANDO DB_BLITZ.xlsx ===\n")
    
    try:
        # Ler todas as abas do arquivo
        excel_file = pd.ExcelFile(arquivo)
        abas = excel_file.sheet_names
        
        print(f"📋 Abas encontradas: {len(abas)}")
        for i, aba in enumerate(abas, 1):
            print(f"  {i}. {aba}")
        
        print("\n" + "="*50)
        
        # Examinar cada aba
        for aba in abas:
            print(f"\n📊 ANALISANDO ABA: {aba}")
            print("-" * 30)
            
            try:
                df = pd.read_excel(arquivo, sheet_name=aba)
                
                print(f"Registros: {len(df)}")
                print(f"Colunas: {len(df.columns)}")
                
                print("\nColunas encontradas:")
                for col in df.columns:
                    # Verificar tipo de dados
                    tipo_pandas = str(df[col].dtype)
                    
                    # Sugerir tipo SQL baseado no tipo pandas
                    if 'int' in tipo_pandas:
                        tipo_sql = 'integer'
                    elif 'float' in tipo_pandas:
                        tipo_sql = 'numeric'
                    elif 'datetime' in tipo_pandas or 'date' in tipo_pandas:
                        tipo_sql = 'date'
                    elif 'bool' in tipo_pandas:
                        tipo_sql = 'boolean'
                    else:
                        tipo_sql = 'text'
                    
                    print(f"  - {col} ({tipo_pandas} -> {tipo_sql})")
                
                # Mostrar algumas linhas de exemplo
                if len(df) > 0:
                    print(f"\nPrimeiras 3 linhas:")
                    print(df.head(3).to_string(index=False))
                
                # Verificar valores únicos em colunas que podem ser chaves
                print(f"\nAnálise de chaves potenciais:")
                for col in df.columns:
                    valores_unicos = df[col].nunique()
                    total_registros = len(df)
                    if valores_unicos == total_registros:
                        print(f"  ✅ {col}: {valores_unicos} valores únicos (pode ser chave primária)")
                    elif valores_unicos < total_registros * 0.9:
                        print(f"  ⚠️  {col}: {valores_unicos} valores únicos de {total_registros} registros")
                
            except Exception as e:
                print(f"❌ Erro ao ler aba {aba}: {e}")
        
        print("\n" + "="*50)
        print("✅ Análise concluída!")
        
    except Exception as e:
        print(f"❌ Erro ao abrir arquivo: {e}")

if __name__ == "__main__":
    examinar_db_blitz()